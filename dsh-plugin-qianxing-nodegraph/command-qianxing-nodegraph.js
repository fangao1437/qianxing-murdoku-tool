// /qianxing-nodegraph —— 千星节点图工具使用说明（本地补丁）
// help / file 子命令会把完整说明打包成 zip 文件发送；其余子命令直接发对应小节文本。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendMarkdownChunked } from "../shared/index.js";

const HOME = os.homedir();
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 说明文件优先级：~/.dsh 下可编辑副本 → 插件包内自带副本 */
function helpFileCandidates() {
    return [
        path.join(HOME, '.dsh', 'qianxing-nodegraph-help.md'),
        path.join(HERE, '..', '..', 'help.md'),
    ];
}

function loadHelp() {
    for (const p of helpFileCandidates()) {
        try {
            if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
        } catch { /* try next */ }
    }
    return '（说明文件缺失：/root/.dsh/qianxing-nodegraph-help.md 或插件包 help.md）';
}

/** 按 "## 标题" 抓一节；找不到返回 null */
function pickSection(text, key) {
    const k = key.toLowerCase();
    const parts = text.split(/^## /m).slice(1);
    for (const part of parts) {
        const title = part.split('\n', 1)[0].trim().toLowerCase();
        if (title.includes(k)) return '## ' + part.trim();
    }
    return null;
}

const SECTIONS = ['千星节点图双向工具链', '能做什么', '工具与参数', '典型流程', '限制（务必如实转告）', '常用命令', '常见问题', '维护'];

/** 英文子命令 → 中文小节 */
const SECTION_MAP = {
    tools: '工具与参数',
    flow: '典型流程',
    limits: '限制',
    faq: '常见问题',
    read: '能做什么',
    files: '维护',
    maintenance: '维护',
};

const SHORT = [
    '**千星节点图工具**（/qianxing-nodegraph）',
    '',
    '`/qianxing-nodegraph help` → 完整说明（**打包成 zip 文件发送**）',
    '`/qianxing-nodegraph tools|flow|limits|faq` → 对应小节（文字）',
].join('\n');

// ── 极简 ZIP（store，无压缩；零依赖） ─────────────────────────────────────
const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function makeZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const DOS_TIME = 0;
    const DOS_DATE = 0x21; // 1980-01-01
    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6); // UTF-8 名称
        local.writeUInt16LE(0, 8); // store
        local.writeUInt16LE(DOS_TIME, 10);
        local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        localParts.push(local, nameBuf, data);

        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(20, 4);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(0x0800, 8);
        cd.writeUInt16LE(0, 10);
        cd.writeUInt16LE(DOS_TIME, 12);
        cd.writeUInt16LE(DOS_DATE, 14);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(data.length, 20);
        cd.writeUInt32LE(data.length, 24);
        cd.writeUInt16LE(nameBuf.length, 28);
        cd.writeUInt16LE(0, 30);
        cd.writeUInt16LE(0, 32);
        cd.writeUInt16LE(0, 34);
        cd.writeUInt16LE(0, 36);
        cd.writeUInt32LE(0, 38);
        cd.writeUInt32LE(offset, 42);
        centralParts.push(cd, nameBuf);

        offset += local.length + nameBuf.length + data.length;
    }
    const cdStart = offset;
    const cdSize = centralParts.reduce((n, b) => n + b.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...localParts, ...centralParts, eocd]);
}

/** 把完整说明打包成 zip 并发文件；失败时退回文本发送 */
async function sendHelpPack(cmdCtx, config, text) {
    const outDir = path.join(HOME, '.dsh', 'qianxing-out');
    fs.mkdirSync(outDir, { recursive: true });
    const zipPath = path.join(outDir, 'qianxing-nodegraph-help.zip');
    const zipBuf = makeZip([{ name: 'qianxing-nodegraph-help.md', data: Buffer.from(text, 'utf8') }]);
    fs.writeFileSync(zipPath, zipBuf);
    try {
        if (typeof cmdCtx.bot?.sendFile === 'function') {
            await cmdCtx.bot.sendFile(cmdCtx.replyTarget, { localPath: zipPath }, { fileName: '千星节点图工具-使用说明.zip' });
            return true;
        }
    } catch (err) {
        // 文件发送失败 → 退回文字说明
        console.error('[qianxing-nodegraph] sendFile failed: ' + (err instanceof Error ? err.message : String(err)));
    }
    await sendMarkdownChunked(cmdCtx, text, config.textChunkLimit);
    return false;
}

export function qianxingNodegraphCommand({ config }) {
    return {
        name: ['qianxing-nodegraph', 'qxgraph'],
        category: 'qqbot',
        description: '千星节点图工具使用说明（打包成文件发送）',
        usage: '/qianxing-nodegraph help',
        handler: async (cmdCtx) => {
            const args = (cmdCtx.command && cmdCtx.command.args) || [];
            const key = (args[0] || 'help').toLowerCase();
            const text = loadHelp();

            // help / file / zip → 打包成文件发送
            if (key === 'help' || key === 'file' || key === 'zip' || key === '-h' || key === '--help') {
                await sendHelpPack(cmdCtx, config, text);
                return { kind: 'noop' };
            }

            let content = null;
            const mapped = SECTION_MAP[key];
            if (mapped) content = pickSection(text, mapped);
            if (!content) {
                const matched = SECTIONS.find((s) => s.toLowerCase().includes(key));
                if (matched) content = pickSection(text, matched);
            }
            if (!content) content = SHORT + '\n\n（没找到「' + key + '」章节；可用：help / tools / flow / limits / faq）';
            await sendMarkdownChunked(cmdCtx, content, config.textChunkLimit);
            return { kind: 'noop' };
        },
    };
}
