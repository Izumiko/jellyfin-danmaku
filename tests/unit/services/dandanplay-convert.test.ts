import { describe, it, expect } from 'vitest';
import { convertDanDanPlayComment } from '@/services/dandanplay/client';

describe('convertDanDanPlayComment', () => {
    it('parses DanDanPlay 4-field p as time,mode,color,user', () => {
        const raw = convertDanDanPlayComment({
            cid: 1,
            p: '12.5,1,16777215,[BiliBili]abc',
            m: 'hello',
        });
        expect(raw).toEqual({
            time: 12.5,
            modeId: 1,
            color: 16777215,
            text: 'hello',
            user: '[BiliBili]abc',
        });
    });

    it('normalizes malformed numeric fields instead of leaking NaN', () => {
        const raw = convertDanDanPlayComment({
            cid: 3,
            p: 'bad,999,999999999,user',
            m: 'broken',
        });

        expect(raw.time).toBe(0);
        // 未知模式原样保留，由 filterByMode 丢弃
        expect(raw.modeId).toBe(999);
        expect(raw.color).toBe(0xffffff);
    });

    it('falls back to scroll mode only when mode is not a number', () => {
        const raw = convertDanDanPlayComment({ cid: 4, p: '1,x,255,u', m: 'm' });
        expect(raw.modeId).toBe(1);
    });

    it('does not wrap user with [DanDanPlay]', () => {
        const raw = convertDanDanPlayComment({
            cid: 2,
            p: '1,5,255,plain-user',
            m: 'top',
        });
        expect(raw.user).toBe('plain-user');
        expect(raw.color).toBe(255);
        expect(raw.modeId).toBe(5);
    });
});
