import {expect, test} from 'bun:test'
import type {Location} from 'react-router'
import {sourceInitializer} from './sourceCallbacks'

const component            = 'components/common/PageTransition.tsx'
const inspection: Location = {
    pathname: '/credentials', search: '?tab=inspection', hash: '', state: null, key: 'inspection',
}
const config: Location     = { pathname: '/config', search: '', hash: '', state: null, key: 'config' }

function renderedLocation(current: Location, status: 'current' | 'exiting', target: Location): Location {
    const locationMatchesCurrentLayer = sourceInitializer<boolean>(component, 'locationMatchesCurrentLayer', {
        currentLayerPathname: current.pathname, currentLayerHash: current.hash, location: target,
    })
    return sourceInitializer<Location>(component, 'renderLocation', {
        layer: { status, location: current }, location: target, locationMatchesCurrentLayer,
    })
}

test('an incoming pathname does not mount in the current page layer during the preceding transition', () => {
    expect(renderedLocation(inspection, 'current', config)).toBe(inspection)
    expect(renderedLocation(inspection, 'exiting', config)).toBe(inspection)
    expect(renderedLocation(config, 'current', config)).toBe(config)
})

test('the current path receives search changes while a new fragment uses its own page layer', () => {
    const search = { ...inspection, search: '?tab=providers', key: 'providers' }
    expect(renderedLocation(inspection, 'current', search)).toBe(search)
    expect(renderedLocation(inspection, 'exiting', search)).toBe(inspection)

    const fragment = { ...inspection, hash: '#quota-refresh-settings', key: 'quota-settings' }
    expect(renderedLocation(inspection, 'current', fragment)).toBe(inspection)
    expect(renderedLocation(fragment, 'current', fragment)).toBe(fragment)
})
