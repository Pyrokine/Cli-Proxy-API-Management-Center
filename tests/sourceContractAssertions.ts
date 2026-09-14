import {expect} from 'bun:test'

const stripWhitespace = (source: string): string => source.replace(/\s+/g, '')

export const expectSourceToContain = (source: string, expected: string): void => {
    expect(stripWhitespace(source)).toContain(stripWhitespace(expected))
}
