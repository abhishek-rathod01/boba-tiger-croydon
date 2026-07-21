/* Boba Tiger Hours Tracker — app.js
 *
 * Orchestration: wizard, tabs, dashboard/clock cards, chat + review cards,
 * manual forms, history view, settings, banners, toasts, event wiring.
 *
 * Deliberately uses a custom in-app modal for every confirmation (clock in/
 * out, delete, restore) instead of native confirm()/prompt()/alert() — those
 * block the whole page on a native OS dialog, which is both poor UX for a
 * warm, custom-designed app and would freeze any automated driving of the
 * page (including our own test/verification passes).
 */
(function (BT) {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $all = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- Toasts --------------------------------------------------------
  function toast(message, variant) {
    var host = $('#toasts');
    var el = document.createElement('div');
    el.className = 'bt-toast' + (variant ? ' bt-toast--' + variant : '');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity 200ms ease';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 220);
    }, 3200);
  }

  // ---- Generic modal (replaces native confirm/prompt) -----------------
  // opts: { title, bodyHtml, fields: [{id,label,type,value,min,max}],
  //         buttons: [{label, variant, isPrimary, onClick(values)}] }
  function showModal(opts) {
    var overlay = document.createElement('div');
    overlay.className = 'bt-wizard-overlay';
    var card = document.createElement('div');
    card.className = 'bt-wizard-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    var html = '<div class="bt-wizard-step">';
    html += '<h3>' + escapeHtml(opts.title) + '</h3>';
    if (opts.bodyHtml) html += '<div>' + opts.bodyHtml + '</div>';
    (opts.fields || []).forEach(function (f) {
      // Use an explicit null/undefined check, not `f.value || ''` — a
      // legitimate value of 0 (e.g. "0 minutes break") is falsy and would
      // otherwise render as a blank field, confusing a non-technical user
      // into thinking they must type something before continuing.
      var fieldValue = (f.value === undefined || f.value === null) ? '' : f.value;
      html += '<div class="bt-field"><label for="modal_' + f.id + '">' + escapeHtml(f.label) + '</label>';
      if (f.type === 'select') {
        html += '<select id="modal_' + f.id + '">';
        (f.options || []).forEach(function (o) {
          html += '<option value="' + escapeHtml(o.value) + '"' + (o.value === f.value ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
        });
        html += '</select>';
      } else {
        html += '<input id="modal_' + f.id + '" type="' + (f.type || 'text') + '" value="' + escapeHtml(fieldValue) + '"' +
          (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') + '>';
      }
      html += '</div>';
    });
    html += '<div class="bt-reviewcard__actions" id="modalActions"></div>';
    html += '</div>';
    card.innerHTML = html;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var actionsHost = $('#modalActions', card);
    function close() { overlay.remove(); }
    (opts.buttons || []).forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bt-btn ' + (b.variant ? 'bt-btn--' + b.variant : 'bt-btn--secondary');
      btn.textContent = b.label;
      btn.addEventListener('click', function () {
        var values = {};
        (opts.fields || []).forEach(function (f) {
          var el = $('#modal_' + f.id, card);
          values[f.id] = el ? el.value : undefined;
        });
        close();
        if (b.onClick) b.onClick(values);
      });
      actionsHost.appendChild(btn);
    });

    // Focus the first field (or first button) for keyboard users.
    setTimeout(function () {
      var firstField = card.querySelector('input, select');
      (firstField || card.querySelector('button')).focus();
    }, 10);

    return close;
  }

  // ---- Banners ----------------------------------------------------------
  function renderBanners() {
    var host = $('#banners');
    host.innerHTML = '';
    var storageInfo = BT.state.storageInfo();

    if (!storageInfo.available) {
      var msg = storageInfo.reason === 'full'
        ? "Your device's storage is full, so changes can't be saved automatically. Please download a backup from Settings regularly, and free up some space when you can."
        : "This browser is blocking saved data (this can happen in private/incognito mode). The app will still work, but nothing will be saved when you close this tab — download a backup from Settings before you leave.";
      addBanner(host, 'danger', msg);
    }

    // 30-day backup reminder.
    var root = BT.state.get();
    if (root && root.settings.setupComplete) {
      var last = root.meta && root.meta.lastBackupAt;
      var daysSince = last ? BT.time.daysBetweenISO(last.slice(0, 10), BT.time.todayISO()) : null;
      if (daysSince === null || daysSince >= 30) {
        addBanner(host, 'info', "It's been a while since your last backup. " +
          '<a href="#" id="bannerBackupLink">Download a backup now</a> — it only takes a second, and it keeps your hours safe if this device is ever lost or reset.');
      }
    }

    // Forgotten clock-out flag (>14h open shifts).
    if (root && root.entries) {
      var openTooLong = root.entries.filter(function (e) {
        if (e.status !== 'open') return false;
        var elapsed = BT.time.elapsedMinutesSince(e.date, e.clockIn);
        return elapsed != null && elapsed > 14 * 60;
      });
      openTooLong.forEach(function (e) {
        var staff = findStaff(e.staffId);
        var name = staff ? staff.name : 'Someone';
        addBanner(host, 'warning', escapeHtml(name) + ' looks like they forgot to clock out — ' +
          '<a href="#" class="bt-fix-forgotten" data-entry="' + e.id + '">fix this entry?</a>');
      });
    }

    var backupLink = $('#bannerBackupLink', host);
    if (backupLink) backupLink.addEventListener('click', function (ev) { ev.preventDefault(); triggerBackupDownload(); });
    $all('.bt-fix-forgotten', host).forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        openManualEditModal(a.getAttribute('data-entry'));
      });
    });
  }

  function addBanner(host, variant, html) {
    var div = document.createElement('div');
    div.className = 'bt-banner bt-banner--' + variant;
    div.innerHTML = html;
    host.appendChild(div);
  }

  function triggerBackupDownload() {
    if (BT.exportData && BT.exportData.downloadBackup) {
      BT.exportData.downloadBackup();
    } else {
      toast('Backup download will be available shortly.', 'danger');
    }
  }

  function openManualEditModal(entryId) {
    openEditEntryModal(entryId);
  }

  // ---- Tabs ---------------------------------------------------------
  function activateTab(name) {
    $all('.bt-tab').forEach(function (btn) {
      var active = btn.getAttribute('data-tab') === name;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $all('.bt-panel').forEach(function (panel) {
      panel.setAttribute('data-active', panel.getAttribute('data-panel') === name ? 'true' : 'false');
    });
  }

  function wireTabs() {
    $all('.bt-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { activateTab(btn.getAttribute('data-tab')); });
    });
  }

  // ---- Staff helpers --------------------------------------------------
  function findStaff(id) {
    var root = BT.state.get();
    return root.staff.find(function (s) { return s.id === id; });
  }
  function activeStaff() {
    var root = BT.state.get();
    return root.staff.filter(function (s) { return s.active !== false; });
  }
  function openEntryForStaff(staffId) {
    var root = BT.state.get();
    return root.entries.find(function (e) { return e.staffId === staffId && e.status === 'open'; });
  }

  // ---- Clock in / out --------------------------------------------------
  function handleClockTap(staffId) {
    var staff = findStaff(staffId);
    if (!staff) return;
    var openEntry = openEntryForStaff(staffId);
    if (openEntry) {
      promptClockOut(staff, openEntry);
    } else {
      promptClockIn(staff);
    }
  }

  function promptClockIn(staff) {
    var nowTime = BT.time.nowHHMM();
    showModal({
      title: 'Clock in ' + staff.name + '?',
      bodyHtml: '<p class="bt-muted">Defaults to right now. Change the time if needed.</p>',
      fields: [{ id: 'time', label: 'Clock-in time', type: 'time', value: nowTime }],
      buttons: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Yes, clock in', variant: 'primary', onClick: function (values) {
            var time = BT.time.parseHHMMToMinutes(values.time) !== null ? values.time : nowTime;
            doClockIn(staff, time);
          }
        }
      ]
    });
  }

  function doClockIn(staff, timeHHMM) {
    var entry = {
      id: BT.state.uid('e'),
      staffId: staff.id,
      date: BT.time.todayISO(),
      clockIn: timeHHMM,
      clockOut: null,
      breakMinutes: 0,
      hoursWorked: null,
      source: 'clock',
      note: '',
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    BT.state.update(function (root) {
      root.entries.push(entry);
      // Snapshot a copy, not the live object — `entry` keeps getting mutated
      // in place (e.g. on clock-out, on later edits), and audit history must
      // freeze what was true at the time, not drift with later changes.
      BT.state.appendAudit(root, 'create', entry.id, null, Object.assign({}, entry), 'clock');
    });
    toast(staff.name + ' clocked in at ' + timeHHMM, 'success');
  }

  function promptClockOut(staff, entry) {
    var nowTime = BT.time.nowHHMM();
    showModal({
      title: 'Clock out ' + staff.name + '?',
      bodyHtml: '<p class="bt-muted">Clocked in at ' + escapeHtml(entry.clockIn) + ' on ' + escapeHtml(BT.time.formatDateDMY(entry.date)) + '.</p>',
      fields: [
        { id: 'time', label: 'Clock-out time', type: 'time', value: nowTime },
        { id: 'breakMinutes', label: 'Break (minutes)', type: 'number', value: entry.breakMinutes || 0, min: 0, max: 600 }
      ],
      buttons: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Yes, clock out', variant: 'success', onClick: function (values) {
            doClockOut(staff, entry, values.time, parseInt(values.breakMinutes, 10) || 0);
          }
        }
      ]
    });
  }

  function doClockOut(staff, entry, timeHHMM, breakMinutes) {
    var result = BT.time.computeHoursWorked(entry.clockIn, timeHHMM, breakMinutes);
    if (!result) {
      toast("That clock-out time doesn't work out to a positive shift — check the time and break, then try again.", 'danger');
      return;
    }
    var before = Object.assign({}, entry);
    BT.state.update(function (root) {
      var e = root.entries.find(function (x) { return x.id === entry.id; });
      e.clockOut = timeHHMM;
      e.breakMinutes = breakMinutes;
      e.hoursWorked = result.hoursWorked;
      e.status = 'complete';
      e.updatedAt = new Date().toISOString();
      BT.state.appendAudit(root, 'edit', e.id, before, Object.assign({}, e), 'clock');
    });
    toast(staff.name + ' clocked out — ' + result.hoursWorked.toFixed(2) + ' hours', 'success');
  }

  // ---- Dashboard rendering --------------------------------------------
  var timerInterval = null;

  function renderNowWorking() {
    var body = $('#nowWorkingBody');
    if (!body) return; // defensive: guards against a render tick racing an unload/navigation
    var root = BT.state.get();
    var openEntries = root.entries.filter(function (e) { return e.status === 'open'; });
    if (openEntries.length === 0) {
      body.className = 'bt-nowworking__empty';
      body.textContent = 'No one is clocked in.';
      return;
    }
    body.className = 'bt-nowworking__list';
    body.innerHTML = openEntries.map(function (e) {
      var staff = findStaff(e.staffId);
      var elapsed = BT.time.elapsedMinutesSince(e.date, e.clockIn);
      return '<div class="bt-nowworking__chip">' +
        '<span class="bt-nowworking__chip-name">' + escapeHtml(staff ? staff.name : '?') + '</span>' +
        '<span class="bt-nowworking__chip-timer">' + escapeHtml(BT.time.formatElapsed(elapsed)) + '</span>' +
        '</div>';
    }).join('');
  }

  function renderClockGrid() {
    var grid = $('#clockGrid');
    if (!grid) return; // defensive: guards against a render tick racing an unload/navigation
    var staffList = activeStaff();
    if (staffList.length === 0) {
      grid.innerHTML = '<p class="bt-muted">No staff added yet — add staff in Settings.</p>';
      return;
    }
    grid.innerHTML = staffList.map(function (s) {
      var openEntry = openEntryForStaff(s.id);
      if (openEntry) {
        var elapsed = BT.time.elapsedMinutesSince(openEntry.date, openEntry.clockIn);
        return '<div class="bt-clockcard bt-clockcard--active">' +
          '<div class="bt-clockcard__name">' + escapeHtml(s.name) + '</div>' +
          '<div class="bt-clockcard__status">Clocked in at ' + escapeHtml(openEntry.clockIn) + '</div>' +
          '<div class="bt-clockcard__timer">' + escapeHtml(BT.time.formatElapsed(elapsed)) + '</div>' +
          '<button type="button" class="bt-btn bt-btn--success bt-btn--block bt-clock-btn" data-staff="' + s.id + '">Clock out</button>' +
          '</div>';
      }
      return '<div class="bt-clockcard">' +
        '<div class="bt-clockcard__name">' + escapeHtml(s.name) + '</div>' +
        '<div class="bt-clockcard__status">Not clocked in</div>' +
        '<button type="button" class="bt-btn bt-btn--primary bt-btn--block bt-clock-btn" data-staff="' + s.id + '">Clock in</button>' +
        '</div>';
    }).join('');
    $all('.bt-clock-btn', grid).forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.classList.add('bt-btn--success-pulse');
        handleClockTap(btn.getAttribute('data-staff'));
      });
    });
  }

  // ---- Wizard ------------------------------------------------------
  function renderWizard() {
    var root = BT.state.get();
    var overlay = $('#wizardOverlay');
    if (root.settings.setupComplete) {
      overlay.hidden = true;
      return;
    }
    overlay.hidden = false;
    var step = root.settings.wizardStep || 'welcome';
    var card = $('#wizardCard');
    if (step === 'welcome') card.innerHTML = wizardWelcomeHtml();
    else if (step === 'key') card.innerHTML = wizardKeyHtml(root);
    else if (step === 'staff') card.innerHTML = wizardStaffHtml(root);
    wireWizardStep(step);
  }

  function setWizardStep(step) {
    BT.state.update(function (root) { root.settings.wizardStep = step; });
  }

  function wizardProgressHtml(activeIdx) {
    var dots = ['welcome', 'key', 'staff'].map(function (s, i) {
      return '<span class="bt-wizard-progress__dot' + (i <= activeIdx ? ' bt-wizard-progress__dot--done' : '') + '"></span>';
    }).join('');
    return '<div class="bt-wizard-progress">' + dots + '</div>';
  }

  function wizardWelcomeHtml() {
    return wizardProgressHtml(0) +
      '<div class="bt-wizard-step">' +
      '<h3 id="wizardTitle">🧋 Welcome to Boba Tiger Hours Tracker</h3>' +
      '<p>This little app helps track staff hours — clocking in and out, or just typing things in plain English.</p>' +
      '<p class="bt-muted">Everything stays on this device. Nothing is sent anywhere except, optionally, to an AI helper you control.</p>' +
      '<button type="button" class="bt-btn bt-btn--primary bt-btn--lg bt-btn--block" id="wizardNext">Let\'s get started</button>' +
      '</div>';
  }

  function wizardKeyHtml(root) {
    return wizardProgressHtml(1) +
      '<div class="bt-wizard-step">' +
      '<h3 id="wizardTitle">Add your free Groq AI key (optional)</h3>' +
      '<p>Groq gives you a free key so the AI can turn plain English into hours entries and answer questions. Get one at ' +
      '<strong>console.groq.com → API Keys → Create API Key</strong>. It starts with <code>gsk_</code>.</p>' +
      '<div class="bt-field"><label for="wizardKeyInput">Groq API key</label>' +
      '<input type="text" id="wizardKeyInput" placeholder="gsk_..." value="' + escapeHtml(root.settings.groqApiKey || '') + '"></div>' +
      '<p class="bt-field__hint">Your key is saved only on this device.</p>' +
      '<div id="wizardKeyStatus" class="bt-muted"></div>' +
      '<div class="bt-row">' +
      '<button type="button" class="bt-btn bt-btn--primary" id="wizardValidateKey">Check key &amp; continue</button>' +
      '<button type="button" class="bt-btn bt-btn--ghost" id="wizardSkipKey">Skip for now — use without AI</button>' +
      '</div></div>';
  }

  function wizardStaffHtml(root) {
    var list = root.staff.map(function (s) {
      return '<div class="bt-row bt-spread" style="padding:6px 0;"><span>' + escapeHtml(s.name) + '</span>' +
        '<button type="button" class="bt-btn bt-btn--ghost wizard-remove-staff" data-id="' + s.id + '">Remove</button></div>';
    }).join('');
    return wizardProgressHtml(2) +
      '<div class="bt-wizard-step">' +
      '<h3 id="wizardTitle">Add your staff</h3>' +
      '<p class="bt-muted">Just first names are fine. Add at least one person to continue.</p>' +
      '<div class="bt-field"><label for="wizardStaffInput">Staff name</label>' +
      '<div class="bt-row"><input type="text" id="wizardStaffInput" placeholder="e.g. Priya" style="flex:1;">' +
      '<button type="button" class="bt-btn bt-btn--secondary" id="wizardAddStaff">Add</button></div></div>' +
      '<div id="wizardStaffList">' + list + '</div>' +
      '<button type="button" class="bt-btn bt-btn--primary bt-btn--lg bt-btn--block" id="wizardFinish"' +
      (root.staff.length === 0 ? ' disabled' : '') + '>Finish setup</button>' +
      '</div>';
  }

  function wireWizardStep(step) {
    if (step === 'welcome') {
      $('#wizardNext').addEventListener('click', function () { setWizardStep('key'); });
    } else if (step === 'key') {
      $('#wizardSkipKey').addEventListener('click', function () { setWizardStep('staff'); });
      $('#wizardValidateKey').addEventListener('click', function () {
        var key = $('#wizardKeyInput').value.trim();
        var statusEl = $('#wizardKeyStatus');
        if (!key) { setWizardStep('staff'); return; }
        if (!BT.ai.validateKey) {
          BT.state.update(function (root) { root.settings.groqApiKey = key; });
          setWizardStep('staff');
          return;
        }
        statusEl.textContent = 'Checking your key…';
        BT.ai.validateKey(key, root_model()).then(function (result) {
          if (result.ok) {
            BT.state.update(function (root) { root.settings.groqApiKey = key; });
            toast('Key looks good!', 'success');
            setWizardStep('staff');
          } else {
            statusEl.textContent = result.message;
          }
        });
      });
    } else if (step === 'staff') {
      function addStaffFromInput() {
        var input = $('#wizardStaffInput');
        var name = input.value.trim();
        if (!name) return;
        BT.state.update(function (root) {
          root.staff.push({ id: BT.state.uid('s'), name: name, active: true, hourlyRate: null });
        });
        input.value = '';
        renderWizard();
        setTimeout(function () { $('#wizardStaffInput').focus(); }, 0);
      }
      $('#wizardAddStaff').addEventListener('click', addStaffFromInput);
      $('#wizardStaffInput').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); addStaffFromInput(); }
      });
      $all('.wizard-remove-staff').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          BT.state.update(function (root) { root.staff = root.staff.filter(function (s) { return s.id !== id; }); });
          renderWizard();
        });
      });
      var finishBtn = $('#wizardFinish');
      if (finishBtn) finishBtn.addEventListener('click', function () {
        BT.state.update(function (root) {
          root.settings.setupComplete = true;
          root.settings.wizardStep = 'done';
          // Treat setup completion as a checkpoint so the "haven't backed up
          // in 30 days" banner doesn't nag a brand-new user on day one.
          if (!root.meta.lastBackupAt) root.meta.lastBackupAt = new Date().toISOString();
        });
        toast('All set! Welcome to Boba Tiger Hours Tracker.', 'success');
      });
    }
  }

  function root_model() { return BT.state.get().settings.model; }

  // ---- Settings tab ----------------------------------------------------
  function maskKey(key) {
    if (!key) return '';
    if (key.length <= 8) return key;
    return key.slice(0, 7) + '…' + key.slice(-4);
  }

  function renderKeySettings() {
    var root = BT.state.get();
    var host = $('#keySettingsSection');
    var hasKey = !!root.settings.groqApiKey;
    var html = '';
    if (hasKey) {
      html += '<p>Current key: <strong>' + escapeHtml(maskKey(root.settings.groqApiKey)) + '</strong></p>';
    } else {
      html += '<p class="bt-muted">No key saved — AI features are off. The app works fully without one.</p>';
    }
    html += '<div class="bt-field"><label for="settingsKeyInput">Groq API key</label>' +
      '<input type="text" id="settingsKeyInput" placeholder="gsk_..." value="">' +
      '<span class="bt-field__hint">Your key is saved only on this device.</span></div>';
    html += '<div class="bt-field"><label for="settingsModelInput">Model</label>' +
      '<input type="text" id="settingsModelInput" value="' + escapeHtml(root.settings.model) + '">' +
      '<span class="bt-field__hint">Only change this if told to by an error message.</span></div>';
    html += '<div class="bt-row">' +
      '<button type="button" class="bt-btn bt-btn--primary" id="settingsSaveKey">Save key</button>' +
      (hasKey ? '<button type="button" class="bt-btn bt-btn--danger" id="settingsRemoveKey">Remove key</button>' : '') +
      '</div>';
    host.innerHTML = html;

    $('#settingsSaveKey').addEventListener('click', function () {
      var key = $('#settingsKeyInput').value.trim();
      var model = $('#settingsModelInput').value.trim() || root.settings.model;
      if (!key) { toast('Type a key first, or use Remove key to clear it.', 'danger'); return; }
      var btn = $('#settingsSaveKey');
      btn.disabled = true; btn.textContent = 'Checking…';
      BT.ai.validateKey(key, model).then(function (result) {
        btn.disabled = false; btn.textContent = 'Save key';
        if (result.ok) {
          BT.state.update(function (r) { r.settings.groqApiKey = key; r.settings.model = model; });
          toast('Key saved.', 'success');
        } else {
          toast(result.message, 'danger');
        }
      });
    });
    var removeBtn = $('#settingsRemoveKey');
    if (removeBtn) removeBtn.addEventListener('click', function () {
      BT.state.update(function (r) { r.settings.groqApiKey = ''; });
      toast('Key removed. AI features are now off.', null);
    });
  }

  function renderStaffSettings() {
    var root = BT.state.get();
    var host = $('#staffSettingsSection');
    var rows = root.staff.map(function (s) {
      return '<div class="bt-row bt-spread" style="padding:8px 0; border-top:1px solid var(--bt-line);">' +
        '<span>' + escapeHtml(s.name) + (s.active === false ? ' <span class="bt-muted">(inactive)</span>' : '') + '</span>' +
        '<button type="button" class="bt-btn bt-btn--secondary bt-staff-toggle" data-id="' + s.id + '">' +
        (s.active === false ? 'Reactivate' : 'Deactivate') + '</button>' +
        '</div>';
    }).join('');
    host.innerHTML =
      '<div class="bt-row"><input type="text" id="settingsStaffInput" placeholder="e.g. Priya" style="flex:1;">' +
      '<button type="button" class="bt-btn bt-btn--primary" id="settingsAddStaff">Add</button></div>' +
      '<p class="bt-field__hint">Staff with saved hours are never deleted — deactivate them instead so their history stays intact.</p>' +
      rows;

    $('#settingsAddStaff').addEventListener('click', function () {
      var input = $('#settingsStaffInput');
      var name = input.value.trim();
      if (!name) return;
      BT.state.update(function (r) { r.staff.push({ id: BT.state.uid('s'), name: name, active: true, hourlyRate: null }); });
      toast(name + ' added.', 'success');
    });
    $all('.bt-staff-toggle', host).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        BT.state.update(function (r) {
          var s = r.staff.find(function (x) { return x.id === id; });
          if (s) s.active = s.active === false ? true : false;
        });
      });
    });
  }

  function renderBackupSettings() {
    var host = $('#backupSettingsSection');
    host.innerHTML =
      '<p class="bt-muted">Keep a copy of your data somewhere safe. Restoring replaces everything currently in the app.</p>' +
      '<div class="bt-row">' +
      '<button type="button" class="bt-btn bt-btn--primary" id="settingsDownloadBackup">Download backup</button>' +
      '<label class="bt-btn bt-btn--secondary" for="settingsRestoreFile" style="cursor:pointer;">Restore from backup</label>' +
      '<input type="file" id="settingsRestoreFile" accept="application/json" class="bt-visually-hidden">' +
      '</div>';
    $('#settingsDownloadBackup').addEventListener('click', function () {
      BT.exportData.downloadBackup();
      toast('Backup downloaded.', 'success');
    });
    $('#settingsRestoreFile').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var result = BT.exportData.parseBackupText(String(reader.result));
        if (!result.ok) { toast(result.message, 'danger'); return; }
        showModal({
          title: 'Replace all current data?',
          bodyHtml: '<p>Restoring <strong>' + escapeHtml(file.name) + '</strong> will replace everything currently saved in this app on this device. This can\'t be undone unless you have another backup.</p>',
          buttons: [
            { label: 'Cancel', variant: 'ghost' },
            {
              label: 'Yes, replace my data', variant: 'danger', onClick: function () {
                BT.exportData.restoreFromData(result.data);
                toast('Backup restored.', 'success');
              }
            }
          ]
        });
      };
      reader.readAsText(file);
    });
  }

  function renderStorageSettings() {
    var host = $('#storageSettingsSection');
    var info = BT.state.storageInfo();
    var kb = (info.bytes / 1024).toFixed(1);
    var pct = Math.min(100, (info.bytes / (5 * 1024 * 1024)) * 100).toFixed(1);
    host.innerHTML = '<p>Using about <strong>' + kb + ' KB</strong> of your device\'s storage (roughly ' + pct + '% of the typical 5 MB browser limit — years of hours entries fit comfortably within this).</p>' +
      (info.available ? '' : '<p class="bt-banner bt-banner--danger">Storage is currently unavailable on this device (' + escapeHtml(info.reason) + ').</p>');
  }

  function renderSettings() {
    renderKeySettings();
    renderStaffSettings();
    renderBackupSettings();
    renderStorageSettings();
  }

  // ---- Shared entry validation (reused by manual form AND, in Phase 4,
  // the AI review card — the same rules apply no matter who typed it) -----
  // input: { staffId, date, clockIn, clockOut, breakMinutes }
  // Returns { ok: true, hoursWorked, overnight } or { ok: false, message }.
  function validateEntryFields(input) {
    var staff = findStaff(input.staffId);
    if (!staff) return { ok: false, message: "That staff member doesn't exist. Pick someone from the list." };
    if (!BT.time.isValidISODate(input.date)) return { ok: false, message: "That date doesn't look right. Use the date picker." };
    if (BT.time.isFutureISO(input.date)) return { ok: false, message: "That date is in the future — hours can only be logged for today or earlier." };
    if (BT.time.parseHHMMToMinutes(input.clockIn) === null) return { ok: false, message: "The clock-in time doesn't look right. Use HH:MM, 24-hour." };
    if (BT.time.parseHHMMToMinutes(input.clockOut) === null) return { ok: false, message: "The clock-out time doesn't look right. Use HH:MM, 24-hour." };
    var breakMinutes = parseInt(input.breakMinutes, 10);
    if (isNaN(breakMinutes) || breakMinutes < 0) return { ok: false, message: 'The break minutes should be a number of 0 or more.' };
    var result = BT.time.computeHoursWorked(input.clockIn, input.clockOut, breakMinutes);
    if (!result) return { ok: false, message: "Those times and break don't add up to a positive shift. Check the clock-out time and break length." };
    return { ok: true, hoursWorked: result.hoursWorked, overnight: result.overnight };
  }

  // Same-date overlap check (heuristic: doesn't chase overlaps across an
  // overnight boundary onto the next calendar day — the common case, same
  // person double-booked on the same day, is what this catches). Returns
  // the first overlapping entry found, or null. `excludeId` skips the
  // entry being edited so it doesn't "overlap" with itself.
  function findOverlap(staffId, date, clockIn, clockOut, excludeId) {
    var root = BT.state.get();
    var newIn = BT.time.parseHHMMToMinutes(clockIn);
    var newOut = BT.time.parseHHMMToMinutes(clockOut);
    var newOutAdj = newOut <= newIn ? newOut + 1440 : newOut;
    return root.entries.find(function (e) {
      if (e.staffId !== staffId || e.date !== date || e.id === excludeId || e.status !== 'complete') return false;
      var exIn = BT.time.parseHHMMToMinutes(e.clockIn);
      var exOut = BT.time.parseHHMMToMinutes(e.clockOut);
      if (exIn === null || exOut === null) return false;
      var exOutAdj = exOut <= exIn ? exOut + 1440 : exOut;
      return newIn < exOutAdj && exIn < newOutAdj;
    }) || null;
  }

  function findDuplicate(staffId, date, clockIn, clockOut, excludeId) {
    var root = BT.state.get();
    return root.entries.find(function (e) {
      return e.staffId === staffId && e.date === date && e.clockIn === clockIn &&
        e.clockOut === clockOut && e.id !== excludeId;
    }) || null;
  }

  // ---- Manual entry form -------------------------------------------
  function renderManualForm() {
    var host = $('#manualFormSection');
    var staffList = activeStaff();
    if (staffList.length === 0) {
      host.innerHTML = '<p class="bt-muted">Add staff in Settings before adding entries.</p>';
      return;
    }
    var options = staffList.map(function (s) { return '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>'; }).join('');
    host.innerHTML =
      '<div class="bt-reviewcard__grid">' +
      '<div class="bt-field"><label for="mfStaff">Staff</label><select id="mfStaff">' + options + '</select></div>' +
      '<div class="bt-field"><label for="mfDate">Date</label><input type="date" id="mfDate" value="' + BT.time.todayISO() + '"></div>' +
      '<div class="bt-field"><label for="mfIn">Clock in</label><input type="time" id="mfIn" value="09:00"></div>' +
      '<div class="bt-field"><label for="mfOut">Clock out</label><input type="time" id="mfOut" value="17:00"></div>' +
      '<div class="bt-field"><label for="mfBreak">Break (minutes)</label><input type="number" id="mfBreak" value="0" min="0"></div>' +
      '</div>' +
      '<div class="bt-field"><label for="mfNote">Note (optional)</label><input type="text" id="mfNote" placeholder="e.g. covered a shift for Sam"></div>' +
      '<button type="button" class="bt-btn bt-btn--primary" id="mfAdd">Add entry</button>';

    $('#mfAdd').addEventListener('click', function () {
      var input = {
        staffId: $('#mfStaff').value,
        date: $('#mfDate').value,
        clockIn: $('#mfIn').value,
        clockOut: $('#mfOut').value,
        breakMinutes: $('#mfBreak').value
      };
      var note = $('#mfNote').value.trim();
      var validation = validateEntryFields(input);
      if (!validation.ok) { toast(validation.message, 'danger'); return; }
      var proceed = function () { createManualEntry(input, note, validation); };
      var dup = findDuplicate(input.staffId, input.date, input.clockIn, input.clockOut, null);
      var overlap = findOverlap(input.staffId, input.date, input.clockIn, input.clockOut, null);
      if (dup) {
        confirmWarning('This looks like a duplicate', 'There\'s already an entry for this person with the same date and times. Save it anyway?', proceed);
      } else if (overlap) {
        confirmWarning('Overlapping shift', 'This overlaps with another entry already saved for the same day. Save it anyway?', proceed);
      } else {
        proceed();
      }
    });
  }

  function confirmWarning(title, bodyText, onConfirm) {
    showModal({
      title: title,
      bodyHtml: '<p>' + escapeHtml(bodyText) + '</p>',
      buttons: [
        { label: 'Cancel', variant: 'ghost' },
        { label: 'Save anyway', variant: 'primary', onClick: onConfirm }
      ]
    });
  }

  function createManualEntry(input, note, validation) {
    var entry = {
      id: BT.state.uid('e'), staffId: input.staffId, date: input.date,
      clockIn: input.clockIn, clockOut: input.clockOut, breakMinutes: parseInt(input.breakMinutes, 10) || 0,
      hoursWorked: validation.hoursWorked, source: 'manual', note: note || '', status: 'complete',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    BT.state.update(function (root) {
      root.entries.push(entry);
      // See the comment in doClockIn — snapshot a copy, not the live object.
      BT.state.appendAudit(root, 'create', entry.id, null, Object.assign({}, entry), 'manual');
    });
    toast('Entry added — ' + validation.hoursWorked.toFixed(2) + ' hours', 'success');
    var noteField = $('#mfNote');
    if (noteField) noteField.value = '';
  }

  // ---- Entries table (list / edit / delete) ---------------------------
  function renderEntries() {
    renderManualForm();
    var body = $('#entriesTableBody');
    var root = BT.state.get();
    var rows = root.entries.slice().sort(function (a, b) { return (b.date + b.clockIn).localeCompare(a.date + a.clockIn); });
    if (rows.length === 0) {
      body.innerHTML = '<tr><td colspan="9" class="bt-muted">No entries yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (e) {
      var staff = findStaff(e.staffId);
      var isOpen = e.status === 'open';
      return '<tr>' +
        '<td>' + escapeHtml(staff ? staff.name : 'Unknown') + '</td>' +
        '<td>' + escapeHtml(BT.time.formatDateDMY(e.date)) + '</td>' +
        '<td>' + escapeHtml(e.clockIn) + '</td>' +
        '<td>' + (isOpen ? '<span class="bt-muted">Still working</span>' : escapeHtml(e.clockOut)) + '</td>' +
        '<td>' + (isOpen ? '—' : escapeHtml(e.breakMinutes) + ' min') + '</td>' +
        '<td>' + (isOpen ? '—' : e.hoursWorked.toFixed(2)) + '</td>' +
        '<td>' + escapeHtml(e.source) + '</td>' +
        '<td>' + escapeHtml(e.note || '') + '</td>' +
        '<td class="bt-row">' +
        '<button type="button" class="bt-btn bt-btn--ghost bt-entry-edit" data-id="' + e.id + '">Edit</button>' +
        '<button type="button" class="bt-btn bt-btn--ghost bt-entry-delete" data-id="' + e.id + '">Delete</button>' +
        '</td></tr>';
    }).join('');
    $all('.bt-entry-edit', body).forEach(function (btn) {
      btn.addEventListener('click', function () { openEditEntryModal(btn.getAttribute('data-id')); });
    });
    $all('.bt-entry-delete', body).forEach(function (btn) {
      btn.addEventListener('click', function () { confirmDeleteEntry(btn.getAttribute('data-id')); });
    });
  }

  function openEditEntryModal(entryId) {
    var root = BT.state.get();
    var entry = root.entries.find(function (e) { return e.id === entryId; });
    if (!entry) return;
    var staffList = activeStaff();
    showModal({
      title: 'Edit entry',
      fields: [
        { id: 'staffId', label: 'Staff', type: 'select', value: entry.staffId, options: staffList.map(function (s) { return { value: s.id, label: s.name }; }) },
        { id: 'date', label: 'Date', type: 'date', value: entry.date },
        { id: 'clockIn', label: 'Clock in', type: 'time', value: entry.clockIn },
        { id: 'clockOut', label: 'Clock out', type: 'time', value: entry.clockOut || BT.time.nowHHMM() },
        { id: 'breakMinutes', label: 'Break (minutes)', type: 'number', value: entry.breakMinutes || 0, min: 0 },
        { id: 'note', label: 'Note', type: 'text', value: entry.note || '' }
      ],
      buttons: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Save changes', variant: 'primary', onClick: function (values) {
            var validation = validateEntryFields(values);
            if (!validation.ok) { toast(validation.message, 'danger'); return; }
            var proceed = function () { saveEntryEdit(entry, values, validation); };
            var dup = findDuplicate(values.staffId, values.date, values.clockIn, values.clockOut, entry.id);
            var overlap = findOverlap(values.staffId, values.date, values.clockIn, values.clockOut, entry.id);
            if (dup) confirmWarning('This looks like a duplicate', 'There\'s already another entry for this person with the same date and times. Save anyway?', proceed);
            else if (overlap) confirmWarning('Overlapping shift', 'This overlaps with another entry already saved for the same day. Save anyway?', proceed);
            else proceed();
          }
        }
      ]
    });
  }

  function saveEntryEdit(entry, values, validation) {
    var before = Object.assign({}, entry);
    BT.state.update(function (root) {
      var e = root.entries.find(function (x) { return x.id === entry.id; });
      e.staffId = values.staffId; e.date = values.date; e.clockIn = values.clockIn;
      e.clockOut = values.clockOut; e.breakMinutes = parseInt(values.breakMinutes, 10) || 0;
      e.hoursWorked = validation.hoursWorked; e.note = values.note || ''; e.status = 'complete';
      e.updatedAt = new Date().toISOString();
      BT.state.appendAudit(root, 'edit', e.id, before, Object.assign({}, e), 'manual');
    });
    toast('Entry updated.', 'success');
  }

  function confirmDeleteEntry(entryId) {
    var root = BT.state.get();
    var entry = root.entries.find(function (e) { return e.id === entryId; });
    if (!entry) return;
    var staff = findStaff(entry.staffId);
    showModal({
      title: 'Delete this entry?',
      bodyHtml: '<p>' + escapeHtml(staff ? staff.name : 'This entry') + ' — ' + escapeHtml(BT.time.formatDateDMY(entry.date)) +
        ', ' + escapeHtml(entry.clockIn) + ' to ' + escapeHtml(entry.clockOut || '?') + '. This can\'t be undone.</p>',
      buttons: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Yes, delete', variant: 'danger', onClick: function () {
            var before = Object.assign({}, entry);
            BT.state.update(function (r) {
              r.entries = r.entries.filter(function (e) { return e.id !== entryId; });
              BT.state.appendAudit(r, 'delete', entryId, before, null, 'manual');
            });
            toast('Entry deleted.', null);
          }
        }
      ]
    });
  }

  // ---- History tab: audit log + chat log (read-only) --------------------
  function summarizeSnapshot(snap) {
    if (!snap) return '—';
    var staff = findStaff(snap.staffId);
    var name = staff ? staff.name : '?';
    if (snap.status === 'open') return escapeHtml(name) + ' — clocked in ' + escapeHtml(snap.clockIn) + ' (open)';
    return escapeHtml(name) + ' — ' + escapeHtml(BT.time.formatDateDMY(snap.date)) + ' ' +
      escapeHtml(snap.clockIn) + '–' + escapeHtml(snap.clockOut) + ', ' +
      (snap.hoursWorked != null ? snap.hoursWorked.toFixed(2) : '?') + 'h';
  }

  function renderHistory() {
    var root = BT.state.get();
    var auditBody = $('#auditTableBody');
    var rows = root.auditLog.slice().reverse();
    auditBody.innerHTML = rows.length === 0
      ? '<tr><td colspan="5" class="bt-muted">Nothing recorded yet.</td></tr>'
      : rows.map(function (a) {
        var when = new Date(a.timestamp);
        return '<tr><td>' + escapeHtml(when.toLocaleString('en-GB')) + '</td>' +
          '<td>' + escapeHtml(a.action) + '</td><td>' + escapeHtml(a.via) + '</td>' +
          '<td>' + summarizeSnapshot(a.before) + '</td><td>' + summarizeSnapshot(a.after) + '</td></tr>';
      }).join('');

    var chatHost = $('#chatHistoryLog');
    if (root.chatLog.length === 0) {
      chatHost.innerHTML = '<p class="bt-muted">No conversations yet.</p>';
    } else {
      chatHost.innerHTML = root.chatLog.map(function (m) {
        return '<div class="bt-msg bt-msg--' + (m.role === 'user' ? 'user' : 'assistant') + '">' + escapeHtml(m.text) + '</div>';
      }).join('');
    }
  }

  // ---- Dashboard weekly/monthly summary (FR9) --------------------------
  // Uses the exact same BT.state.computeTotals that the Q&A context uses,
  // so the two can never disagree.
  function renderSummary() {
    var host = $('#summarySection');
    var root = BT.state.get();
    var today = BT.time.todayISO();
    var week = BT.time.weekRange(today, root.settings.weekStartsOn);
    var month = BT.time.monthRange(today);
    var weekTotals = BT.state.computeTotals(root, week);
    var monthTotals = BT.state.computeTotals(root, month);
    var staffList = activeStaff();

    if (staffList.length === 0) {
      host.innerHTML = '<p class="bt-muted">Add staff to see weekly and monthly totals.</p>';
      return;
    }
    var rows = staffList.map(function (s) {
      return '<tr><td>' + escapeHtml(s.name) + '</td>' +
        '<td>' + (weekTotals.byStaffId[s.id] || 0).toFixed(2) + 'h</td>' +
        '<td>' + (monthTotals.byStaffId[s.id] || 0).toFixed(2) + 'h</td></tr>';
    }).join('');
    host.innerHTML = '<div class="bt-table-wrap"><table class="bt-table">' +
      '<thead><tr><th>Name</th><th>This week</th><th>This month</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="bt-field__hint">Week: ' + escapeHtml(BT.time.formatDateDMY(week.start)) + '–' + escapeHtml(BT.time.formatDateDMY(week.end)) +
      '. Open (still-clocked-in) shifts aren\'t counted in these totals yet.</p>';
  }

  // ---- Export (Excel/.xlsx with CSV fallback) --------------------------
  // Built once, not re-rendered on every state change, so a half-picked
  // date range in the two <input type=date> fields doesn't get wiped out
  // by an unrelated update (e.g. someone clocking in on another tab).
  var exportSectionBuilt = false;
  function renderExportSection() {
    if (exportSectionBuilt) return;
    exportSectionBuilt = true;
    var host = $('#exportSection');
    var month = BT.time.monthRange(BT.time.todayISO());
    host.innerHTML =
      '<div class="bt-row">' +
      '<div class="bt-field"><label for="exportStart">From</label><input type="date" id="exportStart" value="' + month.start + '"></div>' +
      '<div class="bt-field"><label for="exportEnd">To</label><input type="date" id="exportEnd" value="' + month.end + '"></div>' +
      '</div>' +
      '<button type="button" class="bt-btn bt-btn--primary bt-btn--lg" id="exportBtn">Export to Excel</button>' +
      '<p class="bt-field__hint" id="exportStatus">Defaults to this month. Downloads a real .xlsx with Hours, Summary, and Audit Log sheets.</p>';

    $('#exportBtn').addEventListener('click', function () {
      var start = $('#exportStart').value;
      var end = $('#exportEnd').value;
      if (!BT.time.isValidISODate(start) || !BT.time.isValidISODate(end) || start > end) {
        toast('Check the export date range — the "From" date should be on or before the "To" date.', 'danger');
        return;
      }
      var btn = $('#exportBtn');
      var statusEl = $('#exportStatus');
      btn.disabled = true; btn.textContent = 'Exporting…';
      BT.exportData.exportForRange({ start: start, end: end }).then(function (result) {
        btn.disabled = false; btn.textContent = 'Export to Excel';
        if (result.usedFallback) {
          statusEl.textContent = "Couldn't reach the Excel service, so this downloaded as CSV files instead — they open fine in Excel.";
          toast('Downloaded as CSV (Excel service unreachable).', null);
        } else {
          statusEl.textContent = 'Downloaded ' + result.filename + '.';
          toast('Exported to Excel.', 'success');
        }
      });
    });
  }

  // ---- AI chat: natural-language entry + Q&A -------------------------
  // `pendingClarifyQueue` holds ephemeral (non-persisted) follow-up
  // questions the app has asked in chat — e.g. "Who is this for?" — so the
  // user's next message can be interpreted as the answer to it, rather
  // than as a brand-new unrelated message. It's a QUEUE, not a single slot:
  // a multi-entry message ("Priya did X and someone unclear did Y") can
  // raise more than one clarification at once, and every one of them must
  // still get asked and answered — none silently dropped just because
  // another was already pending. Items are asked strictly one at a time,
  // in order; each item's `question` is only sent to chat once it reaches
  // the front (tracked via `asked`), so nothing is asked twice either.
  var pendingClarifyQueue = [];

  function askClarify(clarify, question) {
    pendingClarifyQueue.push({ clarify: clarify, question: question, asked: false });
    maybeAskNextClarify();
  }
  function maybeAskNextClarify() {
    var front = pendingClarifyQueue[0];
    if (front && !front.asked) {
      front.asked = true;
      appendChatMessage('assistant', front.question);
    }
  }

  function aiContext() {
    var root = BT.state.get();
    return { apiKey: root.settings.groqApiKey, model: root.settings.model, staffList: activeStaff(), todayISO: BT.time.todayISO() };
  }

  function renderChatAvailability() {
    var root = BT.state.get();
    var hasKey = !!root.settings.groqApiKey;
    var sendBtn = $('#chatSend');
    var hint = $('#chatHint');
    if (!hasKey) {
      sendBtn.disabled = false; // still allow sending so the user gets a helpful redirect, not a dead button
      hint.textContent = 'Add a free AI key in Settings to use plain-English entry and questions — or use the Entries tab to add hours by hand.';
    } else {
      hint.textContent = 'Type in plain English. Nothing saves until you confirm.';
    }
  }

  function renderChatBox() {
    var root = BT.state.get();
    var host = $('#chatLog');
    host.innerHTML = root.chatLog.map(function (m) {
      return '<div class="bt-msg bt-msg--' + (m.role === 'user' ? 'user' : 'assistant') + '" data-msg-id="' + m.id + '">' + escapeHtml(m.text) + '</div>';
    }).join('');
    host.scrollTop = host.scrollHeight;
  }

  function appendChatMessage(role, text) {
    BT.state.update(function (root) { BT.state.appendChat(root, role, text); });
  }

  function showThinking() {
    var host = $('#chatLog');
    var el = document.createElement('div');
    el.className = 'bt-msg bt-msg--assistant';
    el.textContent = 'One moment…';
    el.setAttribute('data-thinking', '1');
    host.appendChild(el);
    host.scrollTop = host.scrollHeight;
    return function remove() { el.remove(); };
  }

  function wireChat() {
    $('#chatForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var input = $('#chatInput');
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      handleChatSubmit(text);
    });
  }

  async function handleChatSubmit(text) {
    appendChatMessage('user', text);
    var root = BT.state.get();

    if (!root.settings.groqApiKey) {
      appendChatMessage('assistant', "I don't have an AI key yet, so I can't read that. Add a free one in Settings, or use the Entries tab to add this by hand — it only takes a moment.");
      return;
    }

    if (pendingClarifyQueue.length > 0) {
      var front = pendingClarifyQueue.shift();
      await resolvePendingClarify(text, front.clarify);
      maybeAskNextClarify(); // ask whatever's queued next, if this reply didn't already re-raise one
      return;
    }

    var removeThinking = showThinking();
    var result = await BT.ai.classifyAndExtract(text, aiContext());
    removeThinking();

    if (!result.ok) {
      appendChatMessage('assistant', result.message || "Something went wrong — please try again.");
      $('#chatInput').value = text; // never lose what they typed
      return;
    }
    if (result.fallbackUsed) {
      appendChatMessage('assistant', "(Using a backup AI model, since the one in Settings isn't available right now — you may want to update it.)");
    }

    if (result.data.intent === 'question') {
      await handleQuestion(text, result.data.answerContext);
      return;
    }

    if (result.data.entries.length === 0) {
      appendChatMessage('assistant', "I couldn't find hours to log in that — try including a name and times, e.g. \"Priya 9 to 5\".");
      return;
    }
    result.data.entries.forEach(function (rawEntry) { handleFreshEntry(rawEntry); });
  }

  async function handleQuestion(questionText, answerContext) {
    var root = BT.state.get();
    var today = BT.time.todayISO();
    var week = BT.time.weekRange(today, root.settings.weekStartsOn);
    var month = BT.time.monthRange(today);
    var context = {
      today: today,
      staff: activeStaff().map(function (s) { return { id: s.id, name: s.name }; }),
      weekRange: week,
      monthRange: month,
      totalsThisWeekByStaff: BT.state.computeTotals(root, week).byStaffId,
      totalsThisMonthByStaff: BT.state.computeTotals(root, month).byStaffId,
      currentlyClockedIn: root.entries.filter(function (e) { return e.status === 'open'; }).map(function (e) {
        var s = findStaff(e.staffId); return { name: s ? s.name : '?', clockIn: e.clockIn };
      })
    };
    var removeThinking = showThinking();
    var result = await BT.ai.answerQuestion(answerContext || questionText, context, aiContext());
    removeThinking();
    if (!result.ok) {
      appendChatMessage('assistant', result.message || "Something went wrong answering that — please try again.");
      return;
    }
    if (result.fallbackUsed) appendChatMessage('assistant', "(Using a backup AI model — you may want to update Settings.)");
    appendChatMessage('assistant', result.answer);
  }

  // First-pass handling of a freshly-extracted entry from the model. Only
  // here do we check for self-reference — a reply to a clarifying question
  // is never itself a fresh "I worked..." statement, so that check doesn't
  // repeat once we're in the resolve-the-reply path below.
  function handleFreshEntry(rawEntry) {
    if (BT.names.containsSelfReference(rawEntry.nameGuess)) {
      askClarify({ reason: 'self_reference', entryDraft: rawEntry },
        'Who is this for? There\'s no login in this app, so I can\'t tell who "' + escapeHtml(rawEntry.nameGuess) + '" is — type their name.');
      return;
    }
    resolveName(rawEntry.nameGuess, rawEntry);
  }

  function resolveName(nameToMatch, entryDraft) {
    if (!nameToMatch || !nameToMatch.trim()) {
      // An empty/blank name isn't a real "unknown person" — it means we
      // still don't know who this is for. Ask plainly rather than showing
      // an awkward "I don't have anyone called \"\"" message.
      askClarify({ reason: 'self_reference', entryDraft: entryDraft }, "Who is this for? Type their name.");
      return;
    }
    var staffList = activeStaff();
    var match = BT.names.matchStaffName(nameToMatch, staffList);
    if (match.status === 'matched') {
      finishEntryChecks(match.staffId, entryDraft);
    } else if (match.status === 'ambiguous') {
      var names = match.candidates.map(function (c) { return c.name; });
      askClarify({ reason: 'ambiguous', entryDraft: entryDraft, candidates: match.candidates }, 'Did you mean ' + names.join(' or ') + '?');
    } else {
      askClarify({ reason: 'unknown_name', entryDraft: entryDraft, nameGuess: nameToMatch },
        "I don't have anyone called \"" + escapeHtml(nameToMatch) + '" — add them as a new staff member? (yes/no, or type the correct name)');
    }
  }

  // Once a staff member is confidently resolved, check the remaining
  // extracted fields deterministically — never trusting the model's own
  // read of whether it succeeded.
  function finishEntryChecks(staffId, entryDraft) {
    if (!entryDraft.clockIn || !entryDraft.clockOut) {
      var staff = findStaff(staffId);
      askClarify({ reason: 'missing_time', entryDraft: Object.assign({}, entryDraft, { staffId: staffId }) },
        'What time did ' + escapeHtml(staff ? staff.name : 'they') + ' start and finish?');
      return;
    }
    var date = BT.time.isValidISODate(entryDraft.date) ? entryDraft.date : BT.time.todayISO();
    var validation = validateEntryFields({ staffId: staffId, date: date, clockIn: entryDraft.clockIn, clockOut: entryDraft.clockOut, breakMinutes: entryDraft.breakMinutes || 0 });
    if (!validation.ok) {
      askClarify({ reason: 'validation_failed', entryDraft: Object.assign({}, entryDraft, { staffId: staffId, date: date }) },
        validation.message + ' Try telling me again.');
      return;
    }
    renderReviewCard({
      staffId: staffId, date: date, clockIn: entryDraft.clockIn, clockOut: entryDraft.clockOut,
      breakMinutes: entryDraft.breakMinutes || 0, note: entryDraft.note || '', hoursWorked: validation.hoursWorked
    });
  }

  async function resolvePendingClarify(replyText, clarify) {
    if (clarify.reason === 'unknown_name') {
      if (/^(yes|yeah|yep|sure|add|ok(ay)?)\b/i.test(replyText)) {
        var newStaffId = null;
        BT.state.update(function (root) {
          var s = { id: BT.state.uid('s'), name: clarify.nameGuess, active: true, hourlyRate: null };
          root.staff.push(s);
          newStaffId = s.id;
        });
        appendChatMessage('assistant', 'Added ' + escapeHtml(clarify.nameGuess) + ' as a new staff member.');
        finishEntryChecks(newStaffId, clarify.entryDraft);
      } else if (/^(no|nope|cancel)\b/i.test(replyText)) {
        appendChatMessage('assistant', 'No problem — tell me who this is for, or add them in Settings first.');
      } else {
        resolveName(replyText, clarify.entryDraft);
      }
      return;
    }
    if (clarify.reason === 'ambiguous' || clarify.reason === 'self_reference') {
      resolveName(replyText, clarify.entryDraft);
      return;
    }
    if (clarify.reason === 'missing_time' || clarify.reason === 'validation_failed') {
      // Let the AI re-parse casual time/date phrasing from the reply — that's
      // its job, not JS regex — then re-run the same deterministic checks.
      var removeThinking = showThinking();
      var result = await BT.ai.classifyAndExtract(replyText, aiContext());
      removeThinking();
      if (!result.ok || result.data.entries.length === 0) {
        appendChatMessage('assistant', "I still couldn't work that out — try adding this one manually in the Entries tab.");
        return;
      }
      var reExtracted = result.data.entries[0];
      var merged = Object.assign({}, clarify.entryDraft, {
        clockIn: reExtracted.clockIn || clarify.entryDraft.clockIn,
        clockOut: reExtracted.clockOut || clarify.entryDraft.clockOut,
        breakMinutes: (reExtracted.breakMinutes != null ? reExtracted.breakMinutes : clarify.entryDraft.breakMinutes) || 0,
        note: reExtracted.note || clarify.entryDraft.note
      });
      finishEntryChecks(clarify.entryDraft.staffId, merged);
    }
  }

  // ---- AI review cards (nothing saves until Confirm) --------------------
  function renderReviewCard(draft) {
    var host = $('#reviewCards');
    var cardId = BT.state.uid('rc');
    var staffList = activeStaff();
    var options = staffList.map(function (s) { return '<option value="' + s.id + '"' + (s.id === draft.staffId ? ' selected' : '') + '>' + escapeHtml(s.name) + '</option>'; }).join('');
    var el = document.createElement('div');
    el.className = 'bt-reviewcard';
    el.setAttribute('data-card-id', cardId);
    var staff = findStaff(draft.staffId);
    el.innerHTML =
      '<p><strong>I understood:</strong> ' + escapeHtml(staff ? staff.name : '?') + ', ' + escapeHtml(BT.time.formatDateDMY(draft.date)) +
      ', ' + escapeHtml(draft.clockIn) + '–' + escapeHtml(draft.clockOut) +
      (draft.breakMinutes ? ', ' + draft.breakMinutes + ' min break' : '') + ' = <span class="rc-hours">' + draft.hoursWorked.toFixed(2) + '</span> hrs.</p>' +
      '<div class="bt-reviewcard__grid">' +
      '<div class="bt-field"><label>Staff</label><select class="rc-staff">' + options + '</select></div>' +
      '<div class="bt-field"><label>Date</label><input type="date" class="rc-date" value="' + draft.date + '"></div>' +
      '<div class="bt-field"><label>Clock in</label><input type="time" class="rc-in" value="' + draft.clockIn + '"></div>' +
      '<div class="bt-field"><label>Clock out</label><input type="time" class="rc-out" value="' + draft.clockOut + '"></div>' +
      '<div class="bt-field"><label>Break (min)</label><input type="number" class="rc-break" min="0" value="' + (draft.breakMinutes || 0) + '"></div>' +
      '</div>' +
      '<div class="bt-field"><label>Note</label><input type="text" class="rc-note" value="' + escapeHtml(draft.note || '') + '"></div>' +
      '<div class="bt-reviewcard__actions">' +
      '<button type="button" class="bt-btn bt-btn--success rc-confirm">Confirm</button>' +
      '<button type="button" class="bt-btn bt-btn--ghost rc-discard">Discard</button>' +
      '</div>';
    host.appendChild(el);

    function currentValues() {
      return {
        staffId: el.querySelector('.rc-staff').value,
        date: el.querySelector('.rc-date').value,
        clockIn: el.querySelector('.rc-in').value,
        clockOut: el.querySelector('.rc-out').value,
        breakMinutes: el.querySelector('.rc-break').value,
        note: el.querySelector('.rc-note').value
      };
    }
    function recompute() {
      var v = currentValues();
      var validation = validateEntryFields(v);
      el.querySelector('.rc-hours').textContent = validation.ok ? validation.hoursWorked.toFixed(2) : '—';
    }
    $all('.rc-staff, .rc-date, .rc-in, .rc-out, .rc-break', el).forEach(function (input) {
      input.addEventListener('input', recompute);
      input.addEventListener('change', recompute);
    });

    el.querySelector('.rc-discard').addEventListener('click', function () {
      el.remove();
      appendChatMessage('assistant', 'Discarded — nothing saved.');
    });
    el.querySelector('.rc-confirm').addEventListener('click', function () {
      var v = currentValues();
      var validation = validateEntryFields(v);
      if (!validation.ok) { toast(validation.message, 'danger'); return; }
      var proceed = function () {
        var entry = {
          id: BT.state.uid('e'), staffId: v.staffId, date: v.date, clockIn: v.clockIn, clockOut: v.clockOut,
          breakMinutes: parseInt(v.breakMinutes, 10) || 0, hoursWorked: validation.hoursWorked, source: 'ai',
          note: v.note || '', status: 'complete', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        BT.state.update(function (root) {
          root.entries.push(entry);
          BT.state.appendAudit(root, 'create', entry.id, null, Object.assign({}, entry), 'ai');
        });
        el.remove();
        appendChatMessage('assistant', 'Saved — ' + validation.hoursWorked.toFixed(2) + ' hours for ' + (findStaff(v.staffId) || {}).name + '.');
      };
      var dup = findDuplicate(v.staffId, v.date, v.clockIn, v.clockOut, null);
      var overlap = findOverlap(v.staffId, v.date, v.clockIn, v.clockOut, null);
      if (dup) confirmWarning('This looks like a duplicate', 'There\'s already an entry for this person with the same date and times. Save it anyway?', proceed);
      else if (overlap) confirmWarning('Overlapping shift', 'This overlaps with another entry already saved for the same day. Save it anyway?', proceed);
      else proceed();
    });
  }

  // ---- Full render pipeline ------------------------------------------
  function render() {
    renderBanners();
    renderWizard();
    renderNowWorking();
    renderClockGrid();
    renderSettings();
    renderEntries();
    renderHistory();
    renderSummary();
    renderExportSection();
    renderChatAvailability();
    renderChatBox();
  }

  // ---- Boot -----------------------------------------------------------
  function boot() {
    BT.state.load();
    wireTabs();
    wireChat();
    BT.state.subscribe(render);
    render();
    timerInterval = setInterval(function () { renderNowWorking(); renderClockGrid(); }, 30000);
  }

  document.addEventListener('DOMContentLoaded', boot);

  // Exposed for other phase modules and for test/debugging hooks.
  BT.app = {
    $: $, $all: $all, escapeHtml: escapeHtml, toast: toast, showModal: showModal,
    activateTab: activateTab, findStaff: findStaff, activeStaff: activeStaff,
    openEntryForStaff: openEntryForStaff, render: render, addBanner: addBanner,
    triggerBackupDownload: triggerBackupDownload
  };
})(window.BT = window.BT || {});
