import { mount, unmount } from 'svelte';
import InputDialog from './components/InputDialog.svelte';
import SelectDialog from './components/SelectDialog.svelte';

function mountDialog<T>(component: Parameters<typeof mount>[0], props: Record<string, unknown>): Promise<T | null> {
    return new Promise((resolve) => {
        const target = document.createElement('div');
        document.body.appendChild(target);
        const app = mount(component, {
            target,
            props: {
                ...props,
                onConfirm: (value: T) => {
                    cleanup();
                    resolve(value);
                },
                onCancel: () => {
                    cleanup();
                    resolve(null);
                },
            },
        });
        function cleanup() {
            try {
                unmount(app);
            } catch {
                /* already gone */
            }
            target.remove();
        }
    });
}

export async function showInputDialog(title: string, placeholder: string, defaultValue = ''): Promise<string | null> {
    const value = await mountDialog<string>(InputDialog as Parameters<typeof mount>[0], { title, placeholder, defaultValue });
    // 与 ede.js 一致：去除首尾空白，空输入视为取消
    return value?.trim() || null;
}

export function showSelectDialog(title: string, options: string[], defaultIndex = 0): Promise<number | null> {
    return mountDialog<number>(SelectDialog as Parameters<typeof mount>[0], { title, options, defaultIndex });
}
