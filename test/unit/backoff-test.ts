import { expect } from 'chai';
import { backoff } from '../../src/backoff';

describe('test/unit/backoff-test.js', () => {
  const multipliers = [1, 1, 1, 2, 2, 2, 3, 3, 3];

  describe('with values that cannot exceed max backoff', () => {

    it('should backoff according to base and multipliers', () => {
      expect(backoff(10, 1, multipliers, 3600)).to.equal(10);
      expect(backoff(10, 2, multipliers, 3600)).to.equal(10);
      expect(backoff(10, 3, multipliers, 3600)).to.equal(10);
      expect(backoff(10, 4, multipliers, 3600)).to.equal(20);
      expect(backoff(10, 5, multipliers, 3600)).to.equal(40);
      expect(backoff(10, 6, multipliers, 3600)).to.equal(80);
      expect(backoff(10, 7, multipliers, 3600)).to.equal(240);
      expect(backoff(10, 8, multipliers, 3600)).to.equal(720);
    });

  });

  describe('with values that exceeds max backoff', () => {

    it('should be capped at the max backoff', () => {
      expect(backoff(10, 1000, multipliers, 1200)).to.equal(1200);
    });

  });

});
