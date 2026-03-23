import {Card} from '@/components/ui/Card'
import type {PropsWithChildren, ReactNode} from 'react'

interface ConfigSectionProps {
    title: ReactNode;
    description?: ReactNode;
    className?: string;
}

export function ConfigSection({ title, description, className, children }: PropsWithChildren<ConfigSectionProps>) {
    return (
        <Card title={title} className={className}>
            {description && (
                <p className='hint' style={{ margin: '-2px 0 10px 0' }}>
                    {description}
                </p>
            )}
            {children}
        </Card>
    )
}
