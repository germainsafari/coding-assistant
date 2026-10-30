# user-utils

Helpers for showing users.

- `getUserName(user)` returns the name to show for a user: "First Last", or the
  e-mail address when the user has no name.
- `greet(user)` builds a greeting with `getUserName`.
- `memberList(users)` returns a sorted, comma-separated list of names.

Run the tests with `npm test`.
