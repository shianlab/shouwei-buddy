import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
export const migrations = [
  {
    version: 1,
    sql: `
CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,recipient TEXT NOT NULL,goal TEXT NOT NULL,revision INTEGER NOT NULL,activeRunId TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
CREATE TABLE files(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id),logicalFileId TEXT NOT NULL,version INTEGER NOT NULL,role TEXT NOT NULL,originalName TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,encoding TEXT NOT NULL,parseStatus TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(projectId,logicalFileId,version));
CREATE TABLE parses(fileId TEXT PRIMARY KEY REFERENCES files(id),json TEXT NOT NULL);
CREATE TABLE runs(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id),inputRevision INTEGER NOT NULL,state TEXT NOT NULL);
CREATE UNIQUE INDEX one_active_run ON runs(projectId) WHERE state='running';
CREATE TABLE events(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id),sequence INTEGER NOT NULL,type TEXT NOT NULL,time TEXT NOT NULL,payloadVersion INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(projectId,sequence));
`,
  },
  {
    version: 2,
    sql: 'CREATE TABLE workflows(projectId TEXT PRIMARY KEY REFERENCES projects(id),json TEXT NOT NULL);',
  },
  {
    version: 3,
    sql: 'CREATE TABLE deliveries(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id),json TEXT NOT NULL);',
  },
  {
    version: 4,
    sql: `CREATE TABLE deliveries_archive(id TEXT PRIMARY KEY,projectId TEXT NOT NULL,json TEXT NOT NULL);
INSERT INTO deliveries_archive SELECT id,projectId,json FROM deliveries;
DROP TABLE deliveries;
ALTER TABLE deliveries_archive RENAME TO deliveries;`,
  },
]
export function migrate(db: DatabaseSync, steps = migrations) {
  const current = Number(db.prepare('PRAGMA user_version').get()?.user_version)
  if (current > Math.max(...steps.map((s) => s.version)))
    throw new Error('Database is newer than this application')
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const step of steps.filter((s) => s.version > current)) {
      db.exec(step.sql)
      db.exec(`PRAGMA user_version = ${step.version}`)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
export function openDatabase(root: string) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const file = join(root, 'shouwei.sqlite')
  const existed = existsSync(file)
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE;')
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version)
    if (existed && version < migrations.at(-1)!.version)
      db.prepare('VACUUM INTO ?').run(
        join(root, `backup-before-v${migrations.at(-1)!.version}-${Date.now()}.sqlite`),
      )
    migrate(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
