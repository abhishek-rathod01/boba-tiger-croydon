/* Boba Tiger Hours Tracker — Electron main process.
 *
 * Thin wrapper around the existing browser app (src/) — no Node/Electron
 * APIs are exposed to it (no preload script) because it doesn't need any:
 * localStorage, fetch, and Blob/URL downloads are all standard web APIs
 * that work the same inside Chromium whether or not Node integration is
 * on. Keeping nodeIntegration off and contextIsolation on is simply the
 * safer default for an app that renders AI-influenced text.
 *
 * Auto-update: checks GitHub Releases (via electron-updater) shortly after
 * launch and asks before downloading, and again before installing — never
 * silent, matching the app's own "nothing happens without confirmation"
 * design. Only active in a packaged (installed) build; running via
 * `npm start` in development skips update checks entirely.
 */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');

let mainWindow = null;
let updateCheckInFlight = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 480,
    minHeight: 640,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: '#F3E5CF', // matches the app's canvas token, avoids a white flash on load
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Any attempt to open a new window (e.g. a target=_blank link) opens in
  // the user's normal browser instead of a second app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [{ role: 'quit', label: 'Exit' }]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => checkForUpdates({ manual: true })
        },
        {
          label: 'About Boba Tiger Hours Tracker',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Boba Tiger Hours Tracker',
              message: 'Boba Tiger Hours Tracker',
              detail: 'Version ' + app.getVersion() + '\n\nAll your data stays on this device.'
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Auto-update (electron-updater, GitHub Releases) ----------------------
function checkForUpdates(opts) {
  opts = opts || {};
  if (!app.isPackaged) {
    if (opts.manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Check for Updates',
        message: "Update checks only run in the installed app, not this development copy."
      });
    }
    return;
  }
  if (updateCheckInFlight) return;
  updateCheckInFlight = true;

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.removeAllListeners();

  autoUpdater.on('update-available', (info) => {
    updateCheckInFlight = false;
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update available',
      message: 'A new version (' + info.version + ') is available.',
      detail: 'Would you like to download it now? You can keep using the app while it downloads, and nothing installs until you confirm.',
      buttons: ['Download update', 'Not now'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) autoUpdater.downloadUpdate();
    });
  });

  autoUpdater.on('update-not-available', () => {
    updateCheckInFlight = false;
    if (opts.manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Up to date',
        message: "You're on the latest version (" + app.getVersion() + ")."
      });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready to install',
      message: 'The update has finished downloading.',
      detail: "Restart now to finish installing it, or keep working and it'll install next time you close the app.",
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    updateCheckInFlight = false;
    // Never interrupt a shift over a network/update hiccup — the app must
    // work fully offline. Only surface the failure if the user explicitly
    // asked ("Check for Updates…"); a background check just stays quiet.
    if (opts.manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: "Couldn't check for updates",
        message: "Couldn't reach the update server. Check your internet connection and try again later.",
        detail: String((err && err.message) || err)
      });
    }
  });

  autoUpdater.checkForUpdates().catch(() => { updateCheckInFlight = false; });
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  // Quiet background check a few seconds after launch — never interrupts
  // startup, never nags if there's nothing new.
  setTimeout(() => checkForUpdates({ manual: false }), 4000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
