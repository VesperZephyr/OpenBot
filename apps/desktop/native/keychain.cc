// OpenBot's main-process-only Keychain binding. Node-API headers retain their upstream MIT license.
#include <node_api.h>
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#include <string>
#include <vector>
#include <cstring>

namespace {
void Clear(void* data, size_t size) {
  volatile unsigned char* bytes = static_cast<volatile unsigned char*>(data);
  while (size--) *bytes++ = 0;
}
constexpr size_t kSecretLimit = 16384;
struct Work {
  napi_async_work work{};
  napi_deferred deferred{};
  std::string operation, service, account, secret;
  const char* error = nullptr;
  bool missing = false;
  ~Work() { if (!secret.empty()) Clear(secret.data(), secret.size()); }
};

bool ReadString(napi_env env, napi_value value, std::string& out, size_t limit) {
  napi_valuetype type;
  size_t length = 0;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string ||
      napi_get_value_string_utf16(env, value, nullptr, 0, &length) != napi_ok || length == 0 || length > limit) return false;
  std::vector<char16_t> utf16(length + 1);
  napi_get_value_string_utf16(env, value, utf16.data(), utf16.size(), &length);
  bool valid = true;
  for (size_t i = 0; i < length; ++i) {
    auto c = utf16[i];
    if (c == 0 || (c >= 0xdc00 && c <= 0xdfff)) { valid = false; break; }
    if (c >= 0xd800 && c <= 0xdbff) {
      if (++i >= length || utf16[i] < 0xdc00 || utf16[i] > 0xdfff) { valid = false; break; }
    }
  }
  Clear(utf16.data(), utf16.size() * sizeof(char16_t));
  if (!valid || napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok || length > limit) return false;
  std::vector<char> bytes(length + 1);
  napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &length);
  out.assign(bytes.data(), length);
  Clear(bytes.data(), bytes.size());
  return true;
}
const char* ErrorCode(OSStatus status) {
  if (status == errSecAuthFailed || status == errSecInteractionNotAllowed || status == errSecUserCanceled) return "denied";
  return "unavailable";
}
void Execute(napi_env, void* data) {
  auto* w = static_cast<Work*>(data);
  // This process must never display an ACL/unlock prompt, including on a libuv worker thread.
  OSStatus status = SecKeychainSetUserInteractionAllowed(false);
  if (status != errSecSuccess) { w->error = "unavailable"; return; }
  SecKeychainItemRef item = nullptr;
  UInt32 length = 0;
  void* bytes = nullptr;
  const bool read = w->operation == "get";
  status = SecKeychainFindGenericPassword(nullptr, static_cast<UInt32>(w->service.size()), w->service.data(),
    static_cast<UInt32>(w->account.size()), w->account.data(), read ? &length : nullptr, read ? &bytes : nullptr, &item);
  if (read) {
    if (status == errSecItemNotFound) w->missing = true;
    else if (status != errSecSuccess) w->error = ErrorCode(status);
    else if (length == 0 || length > kSecretLimit) w->error = "unavailable";
    else {
      auto text = CFStringCreateWithBytes(nullptr, static_cast<const UInt8*>(bytes), length, kCFStringEncodingUTF8, false);
      if (!text || memchr(bytes, 0, length)) w->error = "unavailable";
      else w->secret.assign(static_cast<char*>(bytes), length);
      if (text) CFRelease(text);
    }
  } else if (w->operation == "delete") {
    if (status == errSecSuccess) status = SecKeychainItemDelete(item);
    if (status != errSecSuccess && status != errSecItemNotFound) w->error = ErrorCode(status);
  } else if (status == errSecSuccess) {
    status = SecKeychainItemModifyAttributesAndData(item, nullptr, static_cast<UInt32>(w->secret.size()), w->secret.data());
    if (status != errSecSuccess) w->error = ErrorCode(status);
  } else if (status == errSecItemNotFound) {
    SecAccessRef access = nullptr;
    // Null means only the calling application is trusted. Never an empty array or an all-applications ACL.
    status = SecAccessCreate(CFSTR("OpenBot credential"), nullptr, &access);
    if (status == errSecSuccess) {
      SecKeychainAttribute attrs[] = {
        { kSecServiceItemAttr, static_cast<UInt32>(w->service.size()), w->service.data() },
        { kSecAccountItemAttr, static_cast<UInt32>(w->account.size()), w->account.data() }
      };
      SecKeychainAttributeList list = { 2, attrs };
      status = SecKeychainItemCreateFromContent(kSecGenericPasswordItemClass, &list,
        static_cast<UInt32>(w->secret.size()), w->secret.data(), nullptr, access, nullptr);
    }
    if (access) CFRelease(access);
    if (status != errSecSuccess) w->error = ErrorCode(status);
  } else w->error = ErrorCode(status);
  if (bytes) { Clear(bytes, length); SecKeychainItemFreeContent(nullptr, bytes); }
  if (item) CFRelease(item);
}
void Complete(napi_env env, napi_status status, void* data) {
  auto* w = static_cast<Work*>(data);
  napi_value value;
  if (status != napi_ok || w->error) {
    napi_value message;
    napi_create_string_utf8(env, w->error ? w->error : "unavailable", NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, nullptr, message, &value);
    napi_reject_deferred(env, w->deferred, value);
  } else {
    if (w->operation == "get" && !w->missing) napi_create_string_utf8(env, w->secret.data(), w->secret.size(), &value);
    else napi_get_null(env, &value);
    napi_resolve_deferred(env, w->deferred, value);
  }
  napi_delete_async_work(env, w->work);
  delete w;
}
napi_value Access(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value args[5];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  auto* w = new Work();
  if (argc < 3 || !ReadString(env, args[0], w->operation, 6) || !ReadString(env, args[1], w->service, 256) ||
      !ReadString(env, args[2], w->account, 128) ||
      (w->operation == "set" ? (argc != 4 || !ReadString(env, args[3], w->secret, kSecretLimit)) :
       (argc != 3 || (w->operation != "get" && w->operation != "delete")))) {
    delete w; napi_throw_error(env, nullptr, "invalid_request"); return nullptr;
  }
  napi_value promise, name;
  napi_create_promise(env, &w->deferred, &promise);
  napi_create_string_utf8(env, "OpenBot Keychain", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, Execute, Complete, w, &w->work) != napi_ok || napi_queue_async_work(env, w->work) != napi_ok) {
    if (w->work) napi_delete_async_work(env, w->work);
    delete w; napi_throw_error(env, nullptr, "unavailable"); return nullptr;
  }
  return promise;
}
napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "access", NAPI_AUTO_LENGTH, Access, nullptr, &fn);
  napi_set_named_property(env, exports, "access", fn);
  return exports;
}
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
