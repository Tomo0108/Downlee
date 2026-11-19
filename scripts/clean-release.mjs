/**
 * 配布物を作る前に release フォルダの古いバージョン（インストーラー・展開済みのアプリ）を消す。
 * `npm run desktop:build` の最初に動く。release はリポジトリに入れない（.gitignore）。
 */
import { existsSync, readdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const release = join(dirname(fileURLToPath(import.meta.url)), "..", "release")
if (existsSync(release)) {
  for (const name of readdirSync(release)) {
    rmSync(join(release, name), { recursive: true, force: true })
    console.log(`release: 古いファイルを削除 ${name}`)
  }
}
