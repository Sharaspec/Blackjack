import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestUsername, validateProfile } from "../js/profile.js";

test("suggests a valid username from the Google name", () => {
  assert.equal(suggestUsername({ user_metadata: { full_name: "Sharon Example" } }), "sharon_example");
  assert.equal(suggestUsername({ user_metadata: { full_name: "José O'Neil" } }), "jose_o_neil");
  assert.equal(suggestUsername({ user_metadata: {}, email: "al@x.com" }), "player_al");
  for (const name of ["A", "Élodie-Marie Fontaine de la Cruz", "李 小龙", "x@y"]) {
    const u = suggestUsername({ user_metadata: { full_name: name } });
    assert.match(u, /^[a-z0-9_]{3,20}$/, `${name} -> ${u}`);
  }
});

test("validates profile fields like the database does", () => {
  const ok = { username: "lucky_7", display_name: "Lucky", bio: "" };
  assert.equal(validateProfile(ok), null);
  assert.ok(validateProfile({ ...ok, username: "ab" }));
  assert.ok(validateProfile({ ...ok, username: "Has Caps" }));
  assert.ok(validateProfile({ ...ok, username: "a".repeat(21) }));
  assert.ok(validateProfile({ ...ok, display_name: "   " }));
  assert.ok(validateProfile({ ...ok, bio: "x".repeat(281) }));
});
