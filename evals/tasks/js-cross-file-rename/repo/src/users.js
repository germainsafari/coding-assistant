/** Name to show for a user: "First Last", or the e-mail when there is no name. */
export function getUserName(user) {
  const name = [user.first, user.last].filter(Boolean).join(' ').trim();
  return name || user.email;
}
