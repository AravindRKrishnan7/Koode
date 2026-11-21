// One-time microphone grant for the extension origin. Chrome's side panel can't always show the
// permission prompt itself; once granted here, the side panel (same origin) can record.
const $ = (id) => document.getElementById(id);
$('go').addEventListener('click', async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop()); // nothing is recorded here
    $('ml').innerHTML = '<span class="ok">✓ അനുവദിച്ചു.</span> ഇനി സൈഡ് പാനലിലെ മൈക്ക് അമർത്തിപ്പിടിച്ച് പറയൂ. ഈ ടാബ് അടയുന്നു…';
    $('en').textContent = 'Microphone allowed. Hold the mic in the Koode side panel and speak. This tab will close…';
    $('go').hidden = true;
    document.body.dataset.koodeMic = 'granted';
    setTimeout(async () => { const t = await chrome.tabs.getCurrent(); if (t) chrome.tabs.remove(t.id); }, 1800);
  } catch (e) {
    document.body.dataset.koodeMic = 'denied:' + e.name;
    $('ml').textContent = 'അനുവാദം കിട്ടിയില്ല. വിലാസ ബാറിലെ ഐക്കൺ വഴി മൈക്രോഫോൺ "Allow" ആക്കി വീണ്ടും ശ്രമിക്കൂ.';
    $('en').textContent = 'Permission was not given (' + e.name + '). Allow the microphone for Koode from the address-bar icon and try again.';
  }
});
