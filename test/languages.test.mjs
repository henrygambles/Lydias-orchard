import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EXT_TO_LANGUAGE,
  isScaffolding,
  languageForExtension,
  primaryLanguage,
} from '../src/languages.mjs'

test('languageForExtension maps known extensions, case-insensitively', () => {
  assert.equal(languageForExtension('.ts'), 'TypeScript')
  assert.equal(languageForExtension('.MJS'), 'JavaScript')
  assert.equal(languageForExtension('.rs'), 'Rust')
  assert.equal(languageForExtension('.hpp'), 'C/C++')
})

test('languageForExtension returns null for anything unlisted', () => {
  assert.equal(languageForExtension('.png'), null)
  assert.equal(languageForExtension(''), null)
  assert.equal(languageForExtension('.notalanguage'), null)
})

test('the extension index has no duplicate extensions across languages', () => {
  assert.ok(Object.keys(EXT_TO_LANGUAGE).length > 40)
  assert.equal(EXT_TO_LANGUAGE['.js'], 'JavaScript')
})

test('primaryLanguage prefers substance over scaffolding', () => {
  const byLanguage = new Map([
    ['Config', 900],
    ['Markdown', 800],
    ['Rust', 100],
  ])
  assert.equal(primaryLanguage(byLanguage), 'Rust')
})

test('primaryLanguage falls back to scaffolding when that is all there is', () => {
  assert.equal(primaryLanguage(new Map([['Markdown', 10], ['Config', 20]])), 'Config')
  assert.equal(primaryLanguage(new Map()), null)
})

test('primaryLanguage breaks ties by name so results are stable', () => {
  assert.equal(primaryLanguage(new Map([['Ruby', 50], ['Go', 50]])), 'Go')
})

test('isScaffolding names only the two support languages', () => {
  assert.ok(isScaffolding('Config'))
  assert.ok(isScaffolding('Markdown'))
  assert.ok(!isScaffolding('Python'))
})
