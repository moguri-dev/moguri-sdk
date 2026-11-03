import { app, BrowserWindow } from "electron";
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 640, height: 400,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const html = '<label>Name<input id="name"></label><button id="go">Apply</button><p id="result"></p><script>document.querySelector("#go").onclick=()=>document.querySelector("#result").textContent="Hello "+document.querySelector("#name").value;</script>';
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
});
