// Making elements. The one copy; every module imports it from here.
//
// make(tag, cls, text): a new element with its class and words. A button
// made here is type="button", so one inside a form never submits it by
// accident; set type = 'submit' on the one that should.
export const make = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (tag === 'button') e.type = 'button';
  return e;
};

// The same, leaving a button's type as the browser has it ("submit" in a
// form). For the older views that were written that way.
export const plain = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
