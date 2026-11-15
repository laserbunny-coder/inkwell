// Every command in the box (Ctrl + K) is added here by the file of the feature
// it belongs to, with addCommands(() => [...]). The list is made when the box
// is set up (commands.js), in the order commandinfo.js gives them, so where a
// command is written doesn't change where it shows. commandinfo.js holds each
// one's group, hint and words, keyed by its label.
//
// This file imports nothing, so any file can add commands as it loads.

const lists = [];

// Shown as Ctrl+ off a Mac (keys.js).
export const mod = '⌘';

// list: () => [command], called once, when the box is set up.
export function addCommands(list) { lists.push(list); }

export function allCommands() { return lists.flatMap((list) => list()); }
