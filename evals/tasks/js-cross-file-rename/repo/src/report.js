import * as users from './users.js';

export function memberList(list) {
  return list
    .map((u) => users.getUserName(u))
    .sort((a, b) => a.localeCompare(b))
    .join(', ');
}
