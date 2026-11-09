/** The extension button: switch the coach on or off (the box on the page follows at once). */
declare const chrome: any;

const box = document.getElementById("on") as HTMLInputElement;
chrome.storage.local.get({ enabled: true }).then((v: { enabled: boolean }) => (box.checked = v.enabled));
box.addEventListener("change", () => chrome.storage.local.set({ enabled: box.checked }));
