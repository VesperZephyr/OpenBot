// Run only on this study: agent-browser eval --stdin < docs/design/d6/verify.js
(() => {
  const passed = [];
  const assert = (label, value) => { if (!value) throw new Error(label); passed.push(label); };
  const click = selector => { const e = document.querySelector(selector); if (!e) throw new Error(`Missing ${selector}`); e.focus(); e.click(); };
  const fill = (selector, value) => { const e = document.querySelector(selector); e.value = value; e.dispatchEvent(new Event('input', {bubbles:true})); };
  const close = () => click('#close-dialog');
  click('[data-scene="welcome"]');
  assert('Welcome has a recognizable character', !!document.querySelector('.companion svg'));
  assert('Welcome has a direct composer', !!document.querySelector('#message'));
  assert('Welcome shows actual fixture memory', document.querySelector('#memory-quote').textContent.includes('Leave some room'));
  click('[data-prompt="Turn my notes into a simple plan."]');
  assert('Starter fills without sending', document.querySelector('#message').value === 'Turn my notes into a simple plan.');
  assert('Starter keeps composer focus', document.activeElement.id === 'message');
  click('#memory');
  assert('Memory editor is a modal', document.querySelector('#dialog').open);
  fill('#memory-input', 'Keep it simple. <b>Literal text</b>');
  click('#save-memory');
  assert('Memory save updates excerpt', document.querySelector('#memory-quote').textContent.includes('<b>Literal text</b>'));
  assert('Memory text is not HTML', document.querySelector('#memory-quote b') === null);
  assert('Memory edit retains draft', document.querySelector('#message').value === 'Turn my notes into a simple plan.');
  click('#resume');
  assert('Resume opens conversation', document.querySelector('.answer h2').textContent === 'Let’s make a little space.');
  assert('Resume retains draft', document.querySelector('#message').value === 'Turn my notes into a simple plan.');
  click('#preview');
  assert('File preview opens', !document.querySelector('#document-panel').hidden);
  assert('Preview gets focus', document.activeElement.id === 'close-panel');
  assert('Preview has real fixture content', document.querySelector('.panel-body').textContent.includes('Protect one morning'));
  if (innerWidth <= 1200) {
    assert('Overlay is a modal dialog', document.querySelector('#document-panel').getAttribute('aria-modal') === 'true');
    assert('Conversation is inert behind preview', document.querySelector('.conversation-column').inert);
    assert('Roster is inert behind preview', document.querySelector('.sidebar').inert);
    assert('Preview scrim is visible', !document.querySelector('#scrim').hidden);
  } else {
    assert('Wide preview is nonmodal', !document.querySelector('#document-panel').hasAttribute('aria-modal'));
    assert('Wide conversation remains usable', !document.querySelector('.conversation-column').inert);
  }
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert('Escape closes preview', document.querySelector('#document-panel').hidden);
  assert('Preview restores opening-control focus', document.activeElement.id === 'preview');
  assert('Preview close restores interaction', !document.querySelector('.sidebar').inert);
  click('[data-person="Scribe"]');
  assert('Different Bot has a separate draft', document.querySelector('#message').value === '');
  click('#profile');
  click('#dialog-memory');
  assert('Different Bot has a separate memory', document.querySelector('#memory-input').value === '');
  close();
  click('[data-person="OpenBot"]');
  assert('Returning to Core opens conversation', document.querySelector('.timeline') !== null);
  assert('Returning to Core retains draft', document.querySelector('#message').value === 'Turn my notes into a simple plan.');
  click('#profile');
  fill('#instructions-input','Be warm and specific.');
  click('#save-instructions');
  click('#profile');
  assert('Instructions persist within demo', document.querySelector('#instructions-input').value === 'Be warm and specific.');
  close();
  click('#search-open');
  fill('#search-query','unmatched words');
  assert('Search empty state', document.querySelector('#search-results').textContent.includes('No conversations match'));
  fill('#search-query','lighter');
  assert('Search returns relevant conversation', document.querySelectorAll('.search-result').length === 1);
  click('[data-search-person="OpenBot"]');
  assert('Search result opens conversation', document.querySelector('.timeline') !== null);
  assert('Search closes its modal', !document.querySelector('#dialog').open);
  click('[data-scene="approval"]');
  assert('Approval shows exact command', document.querySelector('.approval-card pre').textContent === 'python3 create_weekly_plan.py');
  assert('Approval shows bound target', document.querySelector('.approval-card').textContent.includes('This Mac'));
  assert('Reusable grant is separate', !document.querySelector('.approval-card details').open);
  const allow = document.querySelector('#allow').getBoundingClientRect();
  const timeline = document.querySelector('#timeline').getBoundingClientRect();
  assert('Allow once is within visible timeline', allow.top >= timeline.top && allow.bottom <= timeline.bottom + 1);
  click('#deny');
  assert('Deny is recorded as a simulated decision', document.querySelector('.approval-heading').textContent.includes('Denied'));
  assert('Decision does not claim execution', document.querySelector('.approval-card').textContent.includes('No command ran'));
  assert('No duplicate decision control', document.querySelector('#allow') === null);
  click('[data-scene="conversation"]');
  fill('#message','<script>unsafe()</script>');
  document.querySelector('#compose').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  assert('Sent preview is plain text', document.querySelector('.sample-message').textContent === '<script>unsafe()</script>');
  assert('Sent preview cannot inject script', document.querySelector('#messages script') === null);
  assert('Preview send clears draft', document.querySelector('#message').value === '');
  click('#settings');
  assert('Settings is a separate dialog', document.querySelector('#dialog-title').textContent === 'Make yourself at home');
  click('#dialog-theme');
  assert('Settings changes dark appearance', document.documentElement.dataset.theme === 'dark');
  close();
  click('#appearance');
  assert('Study control restores light appearance', document.documentElement.dataset.theme === 'light');
  click('[data-person="Research team"]');
  click('#profile');
  assert('Group shows members rather than Bot memory', document.querySelector('#dialog').textContent.includes('Members') && !document.querySelector('#memory-input'));
  close();
  click('[data-scene="welcome"]');
  assert('No horizontal page overflow', document.documentElement.scrollWidth <= innerWidth);
  const luminance = hex => hex.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  for (const [label,ink,bg] of [
    ['frame text','f3effa','242131'],['frame secondary','b9b3ca','242131'],
    ['light text','30283f','faf9fd'],['light secondary','756c83','faf9fd'],
    ['light link','695093','faf9fd'],['light primary','ffffff','644689'],
    ['dark text','f1eaf9','2c2739'],['dark secondary','c0b5ce','342e43'],
    ['dark primary','ffffff','75509c'],['approval text','865a27','fcf4e6'],
    ['plan inset text','474d34','eff0e3']
  ]) {
    const v=[luminance(ink),luminance(bg)].sort((a,b)=>b-a);
    assert(`${label} contrast >= 4.5`,(v[0]+.05)/(v[1]+.05)>=4.5);
  }
  return {passed:passed.length,viewport:[innerWidth,innerHeight],checks:passed};
})()
