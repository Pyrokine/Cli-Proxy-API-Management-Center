import {IconEye, IconEyeOff} from '@/components/ui/icons'
import type {InputHTMLAttributes, ReactNode} from 'react'
import {useId, useState} from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string
    hint?: ReactNode
    error?: string
    leftElement?: ReactNode
    rightElement?: ReactNode
    secret?: boolean
}

export function Input({
                          label,
                          hint,
                          error,
                          leftElement,
                          rightElement,
                          secret = false,
                          className = '',
                          type,
                          autoComplete,
                          spellCheck,
                          autoCapitalize,
                          autoCorrect,
                          style,
                          ...rest
                      }: InputProps) {
    const generatedId = useId()
    const inputId = rest.id ?? generatedId
    const hintId = hint ? `${inputId}-hint` : undefined
    const errorId = error ? `${inputId}-error` : undefined
    const describedBy = [rest['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined
    const [secretVisible, setSecretVisible] = useState(false)
    const resolvedType                      = secret ? (secretVisible ? 'text' : 'password') : type
    const resolvedAutoComplete              = secret ? (autoComplete ?? 'new-password') : autoComplete
    const resolvedSpellCheck                = secret ? false : spellCheck
    const resolvedAutoCapitalize            = secret ? (autoCapitalize ?? 'none') : autoCapitalize
    const resolvedAutoCorrect               = secret ? (autoCorrect ?? 'off') : autoCorrect
    const resolvedRightElement              = secret ? (
        <button
            type='button'
            onClick={() => setSecretVisible((value) => !value)}
            disabled={Boolean(rest.disabled)}
            aria-label={secretVisible ? 'Hide value' : 'Show value'}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                padding: 0,
                border: 0,
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: rest.disabled ? 'not-allowed' : 'pointer',
            }}
        >
            {secretVisible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
        </button>
    ) : rightElement
    const inputStyle                        = {
        ...(leftElement ? { paddingLeft: 32 } : {}),
        ...(resolvedRightElement ? { paddingRight: 36 } : {}),
        ...style,
    }

    return (
        <div className='form-group'>
            {label && <label htmlFor={inputId}>{label}</label>}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                {leftElement && (
                    <div
                        style={{
                            position: 'absolute',
                            left: 8,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            pointerEvents: 'none',
                            color: 'var(--text-tertiary)',
                        }}
                    >
                        {leftElement}
                    </div>
                )}
                <input
                    {...rest}
                    id={inputId}
                    aria-describedby={describedBy}
                    aria-invalid={rest['aria-invalid'] ?? (error ? true : undefined)}
                    type={resolvedType}
                    autoComplete={resolvedAutoComplete}
                    spellCheck={resolvedSpellCheck}
                    autoCapitalize={resolvedAutoCapitalize}
                    autoCorrect={resolvedAutoCorrect}
                    className={`input ${className}`.trim()}
                    style={inputStyle}
                />
                {resolvedRightElement && (
                    <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>
                        {resolvedRightElement}
                    </div>
                )}
            </div>
            {hint && <div id={hintId} className='hint'>{hint}</div>}
            {error && <div id={errorId} className='error-box'>{error}</div>}
        </div>
    )
}
