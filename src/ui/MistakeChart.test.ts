import {describe, expect, it} from 'vitest'
import {chartPoints} from './MistakeChart'

const parse = (line: string) => line.split(' ').map((pair) => pair.split(',').map(Number))

describe('chartPoints', () => {
  it('draws one point per real reading, left to right by step, lower mistake lower on screen', () => {
    const points = parse(chartPoints([{step: 0, loss: 0.2}, {step: 100, loss: 0.02}, {step: 400, loss: 0.002}]))
    expect(points.length).toBe(3)
    expect(points[0][0]).toBeLessThan(points[1][0])
    expect(points[1][0]).toBeLessThan(points[2][0])
    expect(points[0][1]).toBeLessThan(points[2][1]) // y grows downwards
    // Log scale: the middle reading is exactly halfway between the others in height.
    expect(points[1][1]).toBeCloseTo((points[0][1] + points[2][1]) / 2, 1)
  })

  it('skips readings without a number and needs two points to draw', () => {
    expect(chartPoints([{step: 0, loss: Number.NaN}, {step: 5, loss: 0.1}])).toBe('')
    expect(parse(chartPoints([{step: 0, loss: Number.NaN}, {step: 5, loss: 0.1}, {step: 9, loss: 0.05}])).length).toBe(2)
  })
})
