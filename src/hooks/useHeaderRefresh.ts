import {usePageTransitionLayer} from '@/components/common/PageTransitionLayer'
import {useEffect} from 'react'

type HeaderRefreshHandler = () => void | Promise<void>

let activeHeaderRefreshHandler: HeaderRefreshHandler | null = null

export const triggerHeaderRefresh = async () => {
    if (!activeHeaderRefreshHandler) {
        return
    }
    await activeHeaderRefreshHandler()
}

export const useHeaderRefresh = (pageHandler?: HeaderRefreshHandler | null) => {
    const layer   = usePageTransitionLayer()
    const handler = !layer || layer.status === 'current' ? pageHandler : null
    useEffect(() => {
        if (!handler) {
            return
        }

        activeHeaderRefreshHandler = handler

        return () => {
            if (activeHeaderRefreshHandler === handler) {
                activeHeaderRefreshHandler = null
            }
        }
    }, [handler])
}
