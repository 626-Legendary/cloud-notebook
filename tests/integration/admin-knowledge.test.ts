import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({sqlite:undefined as unknown as Database.Database}));
vi.mock("@/db",()=>({get sqlite(){return state.sqlite;}}));
import { createEntry, deleteEntry } from "@/lib/knowledge";
import { listAdminKnowledge } from "@/lib/admin-knowledge";
let user:string;
beforeEach(()=>{
  state.sqlite=new Database(":memory:");state.sqlite.pragma("foreign_keys=ON");migrate(drizzle(state.sqlite),{migrationsFolder:"drizzle"});
  user=randomUUID();state.sqlite.prepare("INSERT INTO users (id,username,password_hash,role,created_at) VALUES (?,'admin_list_user','unused','USER',?)").run(user,new Date().toISOString());
});
afterEach(()=>state.sqlite.close());
it("searches normalized aliases and literal wildcard characters without exposing bodies",()=>{
  const entry=createEntry(user,{title:"操作系统",aliases:["CPU_100%","OS"]});createEntry(user,{title:"其他",aliases:["CPUX100Y"]});
  for(const query of ["ＣＰＵ_１００%","CPU_100%","ＯＳ"]){const result=listAdminKnowledge(query,"active",1);expect(result.entries.map((item)=>item.id)).toEqual([entry.id]);expect(result.entries[0]).not.toHaveProperty("content");expect(result.entries[0].username).toBe("admin_list_user");}
  expect(listAdminKnowledge("' OR 1=1 --","active",1).total).toBe(0);
});
it("pages active entries separately from trash and clamps an out-of-range page",()=>{
  const entries=Array.from({length:23},(_,index)=>createEntry(user,{title:`条目 ${index}`,aliases:[]}));deleteEntry(user,entries[0].id);deleteEntry(user,entries[1].id);
  const first=listAdminKnowledge("admin_list_user","active",1),last=listAdminKnowledge("admin_list_user","active",99),trash=listAdminKnowledge("admin_list_user","trash",1);
  expect(first.total).toBe(21);expect(first.entries).toHaveLength(20);expect(last.page).toBe(2);expect(last.entries).toHaveLength(1);expect(new Set([...first.entries,...last.entries].map((item)=>item.id)).size).toBe(21);expect(trash.total).toBe(2);expect(trash.entries.every((item)=>item.deletedAt)).toBe(true);
});
