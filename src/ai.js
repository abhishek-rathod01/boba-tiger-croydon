/* Boba Tiger Hours Tracker — ai.js
 *
 * Groq client. The model's job is extraction ONLY — turning casual text into
 * a name guess, a resolved date, resolved times, a break, and a note (or, for
 * a question, a plain restatement of what's being asked). Every decision
 * about whether that extraction is trustworthy enough to show as a ready-to
 * -save review card, versus needing a clarifying question, is made by
 * deterministic JS in app.js (matchStaffName, containsSelfReference,
 * validateEntryFields) — never by an LLM-reported confidence score. This
 * file has no "confidence" or "clarify" field in its contract on purpose.
 *
 * hoursWorked is never read from the model; app.js always recomputes it via
 * BT.time.computeHoursWorked from the (JS-validated) times.
 */
(function (BT) {
  'use strict';

  var ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
  var FALLBACK_MODEL = 'llama-3.1-8b-instant';

  function buildSystemPrompt(staffList, todayISO) {
    var staffLines = staffList.map(function (s) { return s.name + ' (id: ' + s.id + ')'; }).join(', ');
    return [
      'You are a plain-English hours-log assistant for a small UK shop.',
      'Today\'s date is ' + todayISO + ' in the Europe/London timezone. All times are 24-hour.',
      'Active staff (name -> id): ' + (staffLines || '(none yet)') + '.',
      '',
      'Read the user\'s message and decide if it is describing hours worked ("entry") or asking a question about the data ("question").',
      '',
      'For "entry": extract one object per person mentioned into "entries". Each object has:',
      '  nameGuess: the name or pronoun exactly as the user typed it (e.g. "Priya", "pri", "I", "me") — do not resolve it to an id yourself.',
      '  date: resolve relative dates ("today", "yesterday", "last Tuesday") to YYYY-MM-DD using today\'s date above. If no date is mentioned, use today\'s date.',
      '  clockIn / clockOut: resolve casual phrasing ("9 to 5", "11am till 7pm", "9-5") to 24-hour HH:MM. If the message does not give times you can confidently resolve to specific clock times (e.g. "morning shift", "half day", or no times at all), set both to null — do NOT invent times.',
      '  breakMinutes: a number of minutes, 0 if not mentioned.',
      '  note: any extra context worth keeping, or an empty string.',
      'For "question": put a plain restatement of what is being asked into "answerContext" (e.g. "total hours for Sam this week"). Leave "entries" as an empty array.',
      '',
      'Never invent a name, date, or time that is not supported by the message. If unsure, leave the field null rather than guessing.',
      '',
      'Respond with ONLY a JSON object, no other text, matching exactly this shape:',
      '{"intent": "entry" or "question", "entries": [{"nameGuess": string, "date": string or null, "clockIn": string or null, "clockOut": string or null, "breakMinutes": number, "note": string}], "answerContext": string}'
    ].join('\n');
  }

  // Low-level: one chat completion call. Handles the network/HTTP layer only
  // (offline detection, 429 retry-after, model-not-found fallback) — callers
  // handle response-shape validation and JSON-content parsing themselves.
  // Returns one of:
  //   { ok: true, content: string, modelUsed: string, fallbackUsed: boolean }
  //   { ok: false, kind: 'offline' | 'invalid_key' | 'busy' | 'other', message: string }
  async function chatCompletion(apiKey, model, messages, opts) {
    opts = opts || {};
    var payload = {
      model: model,
      messages: messages,
      temperature: 0
    };
    if (opts.jsonMode !== false) payload.response_format = { type: 'json_object' };
    if (opts.maxTokens) payload.max_tokens = opts.maxTokens;

    var result = await attemptOnce(apiKey, model, payload);
    if (result.ok) return result;

    if (result.kind === 'model_not_found' && model !== FALLBACK_MODEL) {
      var fallbackPayload = Object.assign({}, payload, { model: FALLBACK_MODEL });
      var fallbackResult = await attemptOnce(apiKey, FALLBACK_MODEL, fallbackPayload);
      if (fallbackResult.ok) { fallbackResult.fallbackUsed = true; return fallbackResult; }
      return fallbackResult;
    }

    if (result.kind === 'busy' && result.retryAfterSeconds != null) {
      await sleep(Math.min(result.retryAfterSeconds, 15) * 1000);
      var retryResult = await attemptOnce(apiKey, model, payload);
      return retryResult;
    }

    return result;
  }

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  async function attemptOnce(apiKey, model, payload) {
    var response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      return { ok: false, kind: 'offline', message: "The AI service didn't respond. Check your internet and try again — your data is safe." };
    }

    if (response.status === 401) {
      return { ok: false, kind: 'invalid_key', message: "That key doesn't look right — check you copied the whole thing (it starts with gsk_)." };
    }
    if (response.status === 429) {
      var retryAfterHeader = response.headers.get('retry-after');
      var retryAfterSeconds = retryAfterHeader ? parseFloat(retryAfterHeader) : 3;
      return { ok: false, kind: 'busy', retryAfterSeconds: retryAfterSeconds, message: 'The AI is busy — retrying shortly.' };
    }
    if (!response.ok) {
      var bodyText = '';
      try { bodyText = await response.text(); } catch (e2) { /* ignore */ }
      var looksLikeModelIssue = /model/i.test(bodyText) && /(not found|decommissioned|does not exist)/i.test(bodyText);
      if (looksLikeModelIssue) {
        return { ok: false, kind: 'model_not_found', message: 'That AI model is no longer available.' };
      }
      return { ok: false, kind: 'other', message: 'Something went wrong talking to the AI service. Please try again in a moment.' };
    }

    var json;
    try { json = await response.json(); } catch (e3) {
      return { ok: false, kind: 'other', message: 'The AI service sent back something unexpected. Please try again.' };
    }
    var content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (typeof content !== 'string') {
      return { ok: false, kind: 'other', message: 'The AI service sent back something unexpected. Please try again.' };
    }
    return { ok: true, content: content, modelUsed: model, fallbackUsed: false };
  }

  // Key validation: a tiny 1-token request, distinguishing "no internet"
  // from "key rejected" per the spec.
  async function validateKey(apiKey, model) {
    var result = await chatCompletion(apiKey, model || FALLBACK_MODEL,
      [{ role: 'user', content: 'hi' }],
      { jsonMode: false, maxTokens: 1 });
    if (result.ok) return { ok: true, message: 'Key looks good!', fallbackUsed: result.fallbackUsed };
    if (result.kind === 'invalid_key') return { ok: false, message: result.message };
    if (result.kind === 'offline') return { ok: false, message: result.message };
    if (result.kind === 'model_not_found') return { ok: false, message: "That model name isn't recognised by Groq. Try the default model, or check the spelling in Settings." };
    return { ok: false, message: result.message || "Couldn't check the key — please try again." };
  }

  // Classify + extract. See the file header for the schema contract.
  async function classifyAndExtract(text, ctx) {
    var systemPrompt = buildSystemPrompt(ctx.staffList, ctx.todayISO);
    var messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ];
    var result = await chatCompletion(ctx.apiKey, ctx.model, messages, { jsonMode: true });
    if (!result.ok) return result;

    var parsed = tryParseSchema(result.content);
    if (!parsed) {
      // One silent retry with a stricter reinforcement, per spec §5/§7.3.
      var retryMessages = messages.concat([
        { role: 'assistant', content: result.content },
        { role: 'user', content: 'That was not valid JSON matching the schema. Reply with ONLY the JSON object, no other text, no markdown formatting.' }
      ]);
      var retryResult = await chatCompletion(ctx.apiKey, result.modelUsed || ctx.model, retryMessages, { jsonMode: true });
      if (!retryResult.ok) return retryResult;
      parsed = tryParseSchema(retryResult.content);
      if (!parsed) {
        return { ok: false, kind: 'parse_failed', message: "I couldn't understand that — try rephrasing, or add the entry manually." };
      }
      result = retryResult;
    }
    return { ok: true, data: parsed, modelUsed: result.modelUsed, fallbackUsed: !!result.fallbackUsed };
  }

  function tryParseSchema(content) {
    var obj;
    try { obj = JSON.parse(content); } catch (e) { return null; }
    if (!obj || typeof obj !== 'object') return null;
    if (obj.intent !== 'entry' && obj.intent !== 'question') return null;
    if (!Array.isArray(obj.entries)) obj.entries = [];
    if (typeof obj.answerContext !== 'string') obj.answerContext = '';
    return obj;
  }

  // Second call for Q&A: answer strictly from the JS-computed context object
  // (never raw rows the model would have to sum itself).
  async function answerQuestion(question, contextObj, ctx) {
    var systemPrompt = 'You answer questions about staff hours for a small shop, using ONLY the JSON data below — never invent or estimate a number that is not in it. ' +
      'If the data doesn\'t answer the question, say so honestly and plainly. Keep the answer short and in plain English (one or two sentences).\n\nDATA:\n' + JSON.stringify(contextObj);
    var messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question }
    ];
    var result = await chatCompletion(ctx.apiKey, ctx.model, messages, { jsonMode: false });
    if (!result.ok) return result;
    return { ok: true, answer: result.content.trim(), modelUsed: result.modelUsed, fallbackUsed: !!result.fallbackUsed };
  }

  BT.ai = {
    FALLBACK_MODEL: FALLBACK_MODEL,
    buildSystemPrompt: buildSystemPrompt,
    validateKey: validateKey,
    classifyAndExtract: classifyAndExtract,
    answerQuestion: answerQuestion
  };
})(window.BT = window.BT || {});
