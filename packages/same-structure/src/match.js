/* global harden */
// @ts-check

import { sameValueZero, passStyleOf, REMOTE_STYLE } from '@agoric/marshal';
import { assert, details as d, q } from '@agoric/assert';
import { sameStructure } from './sameStructure';

/**
 * Special property name within a copyRecord that marks the copyRecord as
 * representing a non-literal pattern. This is only recognized when the
 * copyRecord appears in a pattern context, such as the `pattern` argument
 * of the `match` function. Aside from those positions, the copyRecord is
 * treated as a normal copyRecord where the contents of the pattern are
 * simply copied. This is true even for the `specimen` argument of the
 * `match` function.
 */
const PATTERN = '@pattern';

const STAR_PATTERN = harden({ [PATTERN]: '*' });

const patternKindOf = pattern => {
  const patternStyle = passStyleOf(pattern);
  if (patternStyle === 'copyRecord' && PATTERN in pattern) {
    return pattern[PATTERN];
  }
  return undefined;
};
harden(patternKindOf);

/**
 *
 */
function match(outerPattern, outerSpecimen) {
  // Although it violates Jessie, don't harden `bindings` yet
  const bindings = { __proto__: null };

  function matchInternal(pattern, specimen) {
    const patternKind = patternKindOf(pattern);
    if (patternKind !== undefined) {
      switch (patternKind) {
        case '*': {
          // wildcard. matches anything.
          return true;
        }
        case 'bind': {
          const { name } = pattern;
          // binds specimen to bindings[name]
          assert.string(name);
          if (name in bindings) {
            // Note: sameStructure rather than match, as both sides came from
            // the outerSpecimen.
            return sameStructure(bindings[name], specimen);
          }
          bindings[name] = specimen;
          return true;
        }
        default: {
          throw assert.fail(d`unrecognized pattern kind ${q(patternKind)}`);
        }
      }
    }
    const patternStyle = passStyleOf(pattern);
    const specimenStyle = passStyleOf(specimen);
    assert(
      patternStyle !== 'promise',
      d`Cannot structurally compare promises: ${pattern}`,
    );
    assert(
      specimenStyle !== 'promise',
      d`Cannot structurally compare promises: ${specimen}`,
    );

    if (patternStyle !== specimenStyle) {
      return false;
    }
    switch (patternStyle) {
      case 'null':
      case 'undefined':
      case 'string':
      case 'boolean':
      case 'number':
      case 'bigint':
      case REMOTE_STYLE: {
        return sameValueZero(pattern, specimen);
      }
      case 'copyRecord':
      case 'copyArray': {
        const leftNames = Object.getOwnPropertyNames(pattern);
        const rightNames = Object.getOwnPropertyNames(specimen);
        if (leftNames.length !== rightNames.length) {
          return false;
        }
        for (const name of leftNames) {
          // TODO: Better hasOwnProperty check
          if (!Object.getOwnPropertyDescriptor(specimen, name)) {
            return false;
          }
          // TODO: Make cycle tolerant
          if (!match(pattern[name], specimen[name])) {
            return false;
          }
        }
        return true;
      }
      case 'copyError': {
        return (
          pattern.name === specimen.name && pattern.message === specimen.message
        );
      }
      default: {
        throw new TypeError(`unrecognized passStyle ${patternStyle}`);
      }
    }
  }
  if (matchInternal(outerPattern, outerSpecimen)) {
    return harden(bindings);
  }
  return undefined;
}
harden(match);

export { PATTERN, STAR_PATTERN, patternKindOf, match };
