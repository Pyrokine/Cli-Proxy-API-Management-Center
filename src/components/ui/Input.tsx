import type { InputHTMLAttributes, ReactNode } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string
    hint?: string
    error?: string
    leftElement?: ReactNode
    rightElement?: ReactNode
}

export function Input({ label, hint, error, leftElement, rightElement, className = '', ...rest }: InputProps) {
    return (
        <div className="form-group">
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
                    className={`input ${className}`.trim()}
                    style={leftElement ? { paddingLeft: 32, ...rest.style } : rest.style}
                    {...rest}
                />
                {rightElement && (
                    <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>
                        {rightElement}
                    </div>
                )}
            </div>
            {hint && <div className="hint">{hint}</div>}
            {error && <div className="error-box">{error}</div>}
        </div>
    )
}
