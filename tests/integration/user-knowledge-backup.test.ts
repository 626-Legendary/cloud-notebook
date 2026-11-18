import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({sqlite:undefined as unknown as Database.Database,file:""}));
vi.mock("@/db",()=>({get sqlite(){return state.sqlite;},get db(){return drizzle(state.sqlite);},get databaseFile(){return state.file;},nowIso:()=>new Date().toISOString()}));
import { createUserExport } from "@/lib/export";
import { restoreUserArchive } from "@/lib/restore";
import { createEntry, getEntry, listEntries, checkReferences } from "@/lib/knowledge";
import { applyTagAction,listTags } from "@/lib/tags";
let directory: string,owner: string,other: string,pageId: string,entryId: string;
const root=process.cwd(),image=fs.readFileSync("tests/fixtures/cover.png"),now="2026-11-18T00:00:00.000Z";
beforeEach(()=>{
 directory=fs.mkdtempSync(path.join(os.tmpdir(),"knowledge-user-backup-"));state.file=path.join(directory,"test.db");state.sqlite=new Database(state.file);state.sqlite.pragma("foreign_keys=ON");state.sqlite.pragma("journal_mode=WAL");migrate(drizzle(state.sqlite),{migrationsFolder:path.join(root,"drizzle")});vi.spyOn(process,"cwd").mockReturnValue(directory);fs.mkdirSync(path.join(directory,"data/uploads/notes"),{recursive:true});
 owner=randomUUID();other=randomUUID();for(const id of [owner,other]){state.sqlite.prepare("INSERT INTO users (id,username,password_hash,role,created_at) VALUES (?,?,'unused','USER',?)").run(id,id,now);state.sqlite.prepare("INSERT INTO folders (id,user_id,name,is_default,created_at,updated_at) VALUES (?,?,'默认',1,?,?)").run(randomUUID(),id,now,now);}
 const asset=randomUUID();fs.writeFileSync(path.join(directory,`data/uploads/notes/${asset}.png`),image);state.sqlite.prepare("INSERT INTO assets (id,user_id,storage_path,mime_type,original_name,size,created_at) VALUES (?,?,?,'image/png','测试',?,?)").run(asset,owner,asset+'.png',image.length,now);
 const entry=createEntry(owner,{title:"知识备份",aliases:["Backup"],content:{type:"doc",content:[{type:"image",attrs:{assetId:asset,src:`/uploads/notes/${asset}`}}]}});entryId=entry.id;
 const folder=state.sqlite.prepare("SELECT id FROM folders WHERE user_id=?").get(owner) as {id:string};const notebook=randomUUID();state.sqlite.prepare("INSERT INTO notebooks (id,user_id,folder_id,title,created_at,updated_at) VALUES (?,?,?,'备份笔记',?,?)").run(notebook,owner,folder.id,now,now);pageId=randomUUID();state.sqlite.prepare("INSERT INTO pages (id,user_id,notebook_id,title,content,created_at,updated_at) VALUES (?,?,?,'知识来源',?,?,?)").run(pageId,owner,notebook,JSON.stringify({type:"doc",content:[{type:"paragraph",content:[{type:"knowledgeReference",attrs:{entryId,label:"知识备份",referenceType:"entry"}}]}]}),now,now);
 applyTagAction(owner,{action:"create",name:"共享"});const tag=listTags(owner)[0].id;applyTagAction(owner,{action:"assign",sourceType:"page",sourceId:pageId,tagIds:[tag]});applyTagAction(owner,{action:"assign",sourceType:"entry",sourceId:entryId,tagIds:[tag]});
});
afterEach(()=>{vi.restoreAllMocks();state.sqlite.close();fs.rmSync(directory,{recursive:true,force:true});});
async function archive(){const stream=await createUserExport(owner),chunks:Buffer[]=[];for await(const chunk of stream) chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
it("administrator user archive restores knowledge, aliases, tags, references and images together",async()=>{
 const bytes=await archive(),result=await restoreUserArchive(other,bytes);expect(result.entries).toBe(1);expect(result.tags).toBe(1);expect(result.pages).toBe(1);
 const entry=listEntries(other)[0];expect(entry.id).not.toBe(entryId);expect(entry.aliases).toEqual(["Backup"]);expect(getEntry(other,entry.id).tags[0].name).toBe("共享");expect(checkReferences(other).statistics.validReferences).toBe(1);
 const content=JSON.parse(getEntry(other,entry.id).content);const asset=content.content[0].attrs.assetId;expect(fs.readFileSync(path.join(directory,`data/uploads/notes/${asset}.png`))).toEqual(image);
});
it("name conflicts roll back the whole user restore and remove all newly written files",async()=>{
 const bytes=await archive();createEntry(other,{title:"冲突名称",aliases:["Backup"]});const before=fs.readdirSync(path.join(directory,"data/uploads/notes"));
 await expect(restoreUserArchive(other,bytes)).rejects.toThrow("已被");expect(fs.readdirSync(path.join(directory,"data/uploads/notes"))).toEqual(before);
 expect(state.sqlite.prepare("SELECT COUNT(*) AS n FROM pages WHERE user_id=?").get(other)).toEqual({n:0});expect(listEntries(other)).toHaveLength(1);
});
