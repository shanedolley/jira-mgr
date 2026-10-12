import { describe, expect, it } from 'vitest'

import { chartPeriod, setChartPeriod } from './timePeriod'

describe('chart period', () => {
  it('starts on days and holds the last choice', () => {
    expect(chartPeriod()).toBe('days')
    setChartPeriod('months')
    expect(chartPeriod()).toBe('months')
    setChartPeriod('days')
  })
})
