/**
 * Svelte action: 将元素传送到指定 DOM 节点
 *
 * 用法: <div use:portal={targetElement}>...</div>
 * 效果: div 将被移动到 targetElement 中
 */
export function portal(node: HTMLElement, target: HTMLElement) {
    target.appendChild(node);

    return {
        update(newTarget: HTMLElement) {
            newTarget.appendChild(node);
        },
        destroy() {
            node.remove();
        },
    };
}
