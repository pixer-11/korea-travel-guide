// Turn reasoning off for a mechanical call (translate a name, extract a field)
// where the model allows it. Sonnet 5 reasons unless told not to, the
// reasoning is billed as output and drawn from max_tokens before a word of the
// answer — the same habit that cut 11 of 20 discovery searches to nothing on
// 2026-10-05. Opus 5.5 / Fable 5 / Mythos 5 refuse `disabled`, so they get
// nothing added and keep their default.
//   client.messages.create({ model: MODEL, ...thinkingOff(MODEL), … })
export const thinkingOff = (model) =>
  (/opus-5-5|fable-5|mythos-5/.test(String(model)) ? {} : { thinking: { type: 'disabled' } });
