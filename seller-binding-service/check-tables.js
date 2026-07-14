const {Pool}=require("pg");
const p=new Pool({host:"100.67.126.90",user:"postgres",password:"***REMOVED_PG_PW***",database:"new_ecommerce",port:5432});
p.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'seller_%' ORDER BY tablename").then(r=>{
  console.log(r.rows.map(x=>x.tablename));
  process.exit(0);
}).catch(e=>{console.error(e.message);process.exit(1)});