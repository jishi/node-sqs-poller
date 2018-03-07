import { backoff } from '../../src/backoff';

describe('test/unit/backoff-test.js', () => {
  const multipliers = [1, 2, 3, 3];

  describe('with values that cannot exceed max backoff', () => {

    it('should backoff according to base and multipliers', () => {
      backoff(10, 1, multipliers, 3600).should.equal(10);
      backoff(10, 2, multipliers, 3600).should.equal(20);
      backoff(10, 3, multipliers, 3600).should.equal(60);
      backoff(10, 4, multipliers, 3600).should.equal(180);
      backoff(10, 5, multipliers, 3600).should.equal(180);
    });

  });

  describe('with values that exceeds max backoff', () => {

    it('should be capped at the max backoff', () => {
      backoff(10000, 4, multipliers, 3600).should.equal(3600);
    });

  });

});
