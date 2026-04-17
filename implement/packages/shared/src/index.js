// @i-am-ios/shared — common utilities

export const VERSION = '2.0.0';

export function fnv32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const NETWORK_DEFAULTS = {
  validatorPort: 8080,
  relayPort:     8091,
  quorum:        1,
};
