import {IconEye, IconEyeOff} from '@/components/ui/icons'
import type {InputHTMLAttributes, ReactNode} from 'react'
import {useState} from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string
    hint?: string
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
            {label && <label>{label}</label>}
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
            {hint && <div className='hint'>{hint}</div>}
            {error && <div className='error-box'>{error}</div>}
        </div>
    )
}
