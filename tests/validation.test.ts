import { describe, it, expect } from 'vitest';
import {
  isValidIPv4,
  isPrivateOrReservedIPv4,
  classifyInput,
} from '@/validation';

describe('isValidIPv4', () => {
  it('accepts valid IPs', () => {
    expect(isValidIPv4('1.2.3.4')).toBe(true);
    expect(isValidIPv4('255.255.255.255')).toBe(true);
    expect(isValidIPv4('0.0.0.0')).toBe(true);
    expect(isValidIPv4('8.8.8.8')).toBe(true);
  });

  it('rejects out-of-range octets', () => {
    expect(isValidIPv4('256.1.1.1')).toBe(false);
    expect(isValidIPv4('1.2.3.999')).toBe(false);
    expect(isValidIPv4('333.333.333.333')).toBe(false);
  });

  it('rejects leading-zero octets (octal SSRF defence)', () => {
    expect(isValidIPv4('001.002.003.004')).toBe(false);
    expect(isValidIPv4('010.0.0.1')).toBe(false);
    expect(isValidIPv4('1.2.3.04')).toBe(false);
  });

  it('rejects malformed inputs', () => {
    expect(isValidIPv4('1.2.3')).toBe(false);
    expect(isValidIPv4('1.2.3.4.5')).toBe(false);
    expect(isValidIPv4('a.b.c.d')).toBe(false);
    expect(isValidIPv4('1.2.3.4 ')).toBe(false);
    expect(isValidIPv4(' 1.2.3.4')).toBe(false);
    expect(isValidIPv4('')).toBe(false);
    expect(isValidIPv4('1.2.3.')).toBe(false);
  });
});

describe('isPrivateOrReservedIPv4', () => {
  it('flags RFC 1918 ranges', () => {
    expect(isPrivateOrReservedIPv4('10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIPv4('10.255.255.255')).toBe(true);
    expect(isPrivateOrReservedIPv4('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedIPv4('172.31.255.255')).toBe(true);
    expect(isPrivateOrReservedIPv4('192.168.1.1')).toBe(true);
  });

  it('does NOT flag 172.15.x.x or 172.32.x.x (just outside RFC 1918)', () => {
    expect(isPrivateOrReservedIPv4('172.15.0.1')).toBe(false);
    expect(isPrivateOrReservedIPv4('172.32.0.1')).toBe(false);
  });

  it('flags loopback / link-local / CGNAT / multicast / reserved / broadcast / unspecified', () => {
    expect(isPrivateOrReservedIPv4('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIPv4('169.254.1.1')).toBe(true);
    expect(isPrivateOrReservedIPv4('100.64.0.1')).toBe(true);
    expect(isPrivateOrReservedIPv4('100.127.255.255')).toBe(true);
    expect(isPrivateOrReservedIPv4('224.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIPv4('239.255.255.255')).toBe(true);
    expect(isPrivateOrReservedIPv4('240.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIPv4('255.255.255.255')).toBe(true);
    expect(isPrivateOrReservedIPv4('0.0.0.0')).toBe(true);
  });

  it('does not flag public IPs', () => {
    expect(isPrivateOrReservedIPv4('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIPv4('1.1.1.1')).toBe(false);
    expect(isPrivateOrReservedIPv4('93.184.216.34')).toBe(false);
    expect(isPrivateOrReservedIPv4('185.60.216.35')).toBe(false);
  });

  it('returns true for non-IPs (defensive default)', () => {
    expect(isPrivateOrReservedIPv4('not-an-ip')).toBe(true);
    expect(isPrivateOrReservedIPv4('256.256.256.256')).toBe(true);
  });
});

describe('classifyInput', () => {
  it('classifies a valid IP as ip', () => {
    expect(classifyInput('8.8.8.8')).toEqual({ kind: 'ip', value: '8.8.8.8' });
  });

  it('classifies a valid domain as domain', () => {
    expect(classifyInput('example.com')).toEqual({
      kind: 'domain',
      value: 'example.com',
    });
  });

  it('strips http(s) and trailing path/slash', () => {
    expect(classifyInput('https://www.example.com/')).toEqual({
      kind: 'domain',
      value: 'www.example.com',
    });
    expect(classifyInput('http://example.com/some/path')).toEqual({
      kind: 'domain',
      value: 'example.com',
    });
  });

  it('lowercases input', () => {
    expect(classifyInput('Example.COM')).toEqual({
      kind: 'domain',
      value: 'example.com',
    });
  });

  it('rejects too-long inputs', () => {
    expect(classifyInput('x'.repeat(254))).toEqual({ kind: 'invalid' });
  });

  it('rejects malformed', () => {
    expect(classifyInput('not a valid input')).toEqual({ kind: 'invalid' });
    expect(classifyInput('')).toEqual({ kind: 'invalid' });
    expect(classifyInput('   ')).toEqual({ kind: 'invalid' });
    expect(classifyInput('foo')).toEqual({ kind: 'invalid' });
  });

  it('rejects single-label domains (need at least one dot)', () => {
    expect(classifyInput('localhost')).toEqual({ kind: 'invalid' });
  });

  it('rejects domain labels longer than 63 chars', () => {
    const longLabel = 'a'.repeat(64);
    expect(classifyInput(`${longLabel}.com`)).toEqual({ kind: 'invalid' });
  });
});
