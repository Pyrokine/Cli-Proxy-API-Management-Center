/**
 * LocalStorage Hook
 */

import {useCallback, useRef, useState} from 'react'

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
    const readValue           = () => {
        try {
            const item = window.localStorage.getItem(key)
            return item ? (JSON.parse(item) as T) : initialValue
        } catch (error) {
            console.error(`Error reading localStorage key "${key}":`, error)
            return initialValue
        }
    }
    const [stored, setStored] = useState(() => ({ key, value: readValue() }))
    const current             = useRef(stored)
    if (current.current.key !== key) {
        current.current = { key, value: readValue() }
        setStored(current.current)
    }

    const setValue = useCallback((value: T | ((val: T) => T)) => {
        try {
            const valueToStore = value instanceof Function ? value(current.current.value) : value
            current.current    = { key: current.current.key, value: valueToStore }
            setStored(current.current)
            window.localStorage.setItem(current.current.key, JSON.stringify(valueToStore))
        } catch (error) {
            console.error(`Error setting localStorage key "${current.current.key}":`, error)
        }
    }, [])

    return [current.current.value, setValue]
}
