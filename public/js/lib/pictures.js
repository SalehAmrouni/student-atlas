// The pictures for picture passwords, shared by the browser and the server.
// A picture password is PICTURE_LENGTH of these, in order (repeats allowed):
// 20 × 20 × 20 = 8,000 possible passwords. That's only safe because the server
// locks an account's picture password after a few wrong tries (see
// server/accounts/handler.js), so nobody gets anywhere near 8,000 guesses.

export const PICTURES = [
  { emoji: '🐶', name: 'Dog' },
  { emoji: '🐱', name: 'Cat' },
  { emoji: '🦊', name: 'Fox' },
  { emoji: '🐼', name: 'Panda' },
  { emoji: '🐸', name: 'Frog' },
  { emoji: '🐙', name: 'Octopus' },
  { emoji: '🦋', name: 'Butterfly' },
  { emoji: '🐢', name: 'Turtle' },
  { emoji: '🍎', name: 'Apple' },
  { emoji: '🍕', name: 'Pizza' },
  { emoji: '🌮', name: 'Taco' },
  { emoji: '🍩', name: 'Donut' },
  { emoji: '⚽', name: 'Soccer ball' },
  { emoji: '🎸', name: 'Guitar' },
  { emoji: '🚀', name: 'Rocket' },
  { emoji: '🚲', name: 'Bike' },
  { emoji: '🌈', name: 'Rainbow' },
  { emoji: '⭐', name: 'Star' },
  { emoji: '🌙', name: 'Moon' },
  { emoji: '🔥', name: 'Fire' },
];

export const PICTURE_LENGTH = 3;

/** True for a list of PICTURE_LENGTH valid picture indexes. */
export function isPictureSequence(seq) {
  return Array.isArray(seq) && seq.length === PICTURE_LENGTH
    && seq.every((i) => Number.isInteger(i) && i >= 0 && i < PICTURES.length);
}
