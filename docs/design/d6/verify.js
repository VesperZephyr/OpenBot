// Run against prototype.html only: agent-browser eval --stdin < verify.js
(() => {
  const passed = [];
  const assert = (name, value) => {
    if (!value) throw new Error(name);
    passed.push(name);
  };
  const click = (selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing control: ${selector}`);
    element.click();
  };
  click('[data-scene="result"]');
  assert('Result title is visible', document.querySelector('.answer h2').textContent.includes('report'));
  click('#preview');
  assert('Report opens', !document.querySelector('#inspector').hidden);
  assert('Panel receives focus', document.activeElement.id === 'close-panel');
  assert('Report contains data table', document.querySelector('#inspector tbody').rows.length === 3);
  click('#close-panel');
  assert('Panel closes', document.querySelector('#inspector').hidden);
  click('#csv');
  assert('CSV preview uses correct filename', document.querySelector('#inspector').textContent.includes('weekly-summary.csv'));
  click('#close-panel');
  click('#details');
  assert('Profile opens', document.querySelector('#inspector').textContent.includes('Instructions'));
  click('#close-panel');
  const draft = document.querySelector('#message');
  draft.value = 'Draft retained during navigation';
  draft.dispatchEvent(new Event('input', { bubbles: true }));
  click('[data-person="Scribe"]');
  assert('Each Bot has a separate draft', document.querySelector('#message').value === '');
  click('[data-person="Atlas"]');
  assert('Bot switch retains draft', document.querySelector('#message').value === 'Draft retained during navigation');
  click('#settings');
  assert('Settings models category opens', document.querySelector('.settings-content h2').textContent === 'Models');
  click('[data-settings-tab="Permissions"]');
  assert('Permission explanation is visible', document.querySelector('.settings-content').textContent.includes('take precedence'));
  click('[data-scene="result"]');
  assert('Settings navigation retains draft', document.querySelector('#message').value === 'Draft retained during navigation');
  const input = document.querySelector('#search');
  input.value = 'No such teammate';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert('Search has an empty state', !document.querySelector('#no-results').hidden);
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert('Clearing search restores roster', document.querySelector('#no-results').hidden);
  click('[data-scene="approval"]');
  assert('Approval includes exact command', document.querySelector('.approval pre').textContent.includes('python3 generate_report.py'));
  assert('Approval includes target', document.querySelector('.approval').textContent.includes('This Mac'));
  assert('Reusable scope is separate', document.querySelector('.approval details').open === false);
  click('#allow');
  assert('Decision is clearly simulated', document.querySelector('.approval').textContent.includes('No command was executed'));
  assert('Decision controls are removed', document.querySelector('#allow') === null);
  click('#new');
  assert('New dialog opens', document.querySelector('#new-dialog').open);
  click('[data-close-dialog]');
  assert('New dialog closes', !document.querySelector('#new-dialog').open);
  click('[data-scene="result"]');
  const message = document.querySelector('#message');
  message.value = '<script>unsafe()</script>';
  document.querySelector('#compose').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  assert('Preview send uses plain text', document.querySelector('#messages').lastElementChild.textContent === '<script>unsafe()</script>');
  assert('Preview send does not inject markup', document.querySelector('#messages script') === null);
  assert('Preview send clears input', document.querySelector('#message').value === '');
  click('#theme');
  assert('Dark appearance changes tokens', document.documentElement.dataset.theme === 'dark');
  click('#theme');
  assert('Light appearance restores tokens', document.documentElement.dataset.theme === 'light');
  assert('No page horizontal overflow', document.documentElement.scrollWidth <= window.innerWidth);
  // Fixture typography contrast, independent of browser antialiasing.
  const luminance = (hex) => {
    const rgb = hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const [label, foreground, background] of [
    ['light body', '202b3d', 'ffffff'],
    ['light secondary', '5f6c80', 'edf1f6'],
    ['light link', '315fd4', 'ffffff'],
    ['light approval', '865917', 'fff8eb'],
    ['dark body', 'e7edf7', '19212e'],
    ['dark secondary', 'a5b2c6', '202b3a'],
    ['dark link', 'a9c1ff', '19212e'],
    ['dark button', 'ffffff', '3f6ed8'],
  ]) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    assert(`${label} contrast >= 4.5`, (values[0] + 0.05) / (values[1] + 0.05) >= 4.5);
  }
  return { passed: passed.length, checks: passed };
})()
