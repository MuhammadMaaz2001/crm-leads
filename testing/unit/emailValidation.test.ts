import { describe, expect, it } from 'vitest';
import { isValidEmail } from '../../server/config';

describe('isValidEmail', () => {
  it.each([
    'someone@gmail.com',
    'someone@outlook.com',
    'someone@yahoo.co.uk',
    'first.last+tag@company.io',
    'user@sub.domain.example.org',
    'founder.seed@convobrains.com',
    '  Padded@Example.com  ',
  ])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    '',
    'plainaddress',
    '@example.com',
    'user@',
    'user@nodot',
    'user@@example.com',
    'user name@example.com',
    'user@example..com',
    'user@.example.com',
    'user@example.com.',
    `${'a'.repeat(250)}@example.com`,
  ])('rejects %j', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});
