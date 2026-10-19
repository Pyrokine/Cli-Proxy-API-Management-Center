export function shouldExitLogFullscreen(
    event: Pick<KeyboardEvent, 'key' | 'defaultPrevented'>,
    hasOpenModal: boolean,
): boolean {
    return event.key === 'Escape' && !event.defaultPrevented && !hasOpenModal
}
