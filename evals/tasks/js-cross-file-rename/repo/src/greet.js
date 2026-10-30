import { getUserName } from './users.js';

export function greet(user) {
  return `Hello, ${getUserName(user)}!`;
}
