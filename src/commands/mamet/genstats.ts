import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, Connection } from '@salesforce/core';
import { AnyJson  } from '@salesforce/ts-types';
import * as fs from 'fs';
import * as vm from 'vm';

//import { QueryResult } from 'jsforce';

import {Entryp} from '../../mamutils/mametUtils';


// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('mamet', 'genstats');

export default class genstats extends SfdxCommand {

  public static description = messages.getMessage('commandDescription');

  public static examples = [
  `$ sfdx mamet:genstats --prevfile mametST.js --targetusername myOrg@example.com
  Write org activity and performance statistics in the file mametST.js
  Information comes from event monitoring, and it updates stats from prevfile
  `];

  public static args = [{name: 'file'}];
  protected static flagsConfig = {
    prevfile: flags.string({char: 'p', description: messages.getMessage('prevfileFlagDescription')})
  };
  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;
  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;


  public async run(): Promise<AnyJson> {
    let mametstats: {[key: string]: Entryp} = {};  
    const conn : Connection = this.org.getConnection();

    let apexid = await this.getDatasetID(conn, "ApexExecution");
    let apexQuery = { "query":`q = load "${apexid}"; result = group q by 'ENTRY_POINT'; result = foreach result generate q.'ENTRY_POINT' as 'name', count(q) as 'nbcalls', avg(q.'RUN_TIME') as 'avgtime', sum(q.'RUN_TIME') as 'totaltime', percentile_cont(0.95) within group (order by q.'RUN_TIME') as 'p95time', max(TIMESTAMP_DERIVED_sec_epoch) as 'lastused'; result = order result by ('name' asc);result = limit result 5000;`};
    await this.queryStats(conn,mametstats, apexQuery,"AXAPX");
  

    let triggerid = await this.getDatasetID(conn, "ApexTrigger");
    let triggerQuery = { "query":`q = load "${triggerid}"; result = group q by 'TRIGGER_NAME'; result = foreach result generate q.'TRIGGER_NAME' as 'name', count(q) as 'nbcalls', percentile_cont(0.95) within group (order by q.'EXEC_TIME') as 'p95time', sum(q.'EXEC_TIME') as 'totaltime', avg(q.'EXEC_TIME') as 'avgtime', max(TIMESTAMP_DERIVED_sec_epoch) as 'lastused'; result = order result by ('name' desc); result = limit result 5000;`};
    await this.queryStats(conn,mametstats, triggerQuery,"TRIGGER");


    let vfid = await this.getDatasetID(conn, "VisualforceRequest");
    let vfQuery = { "query":`q = load "${vfid}"; result = group q by 'PAGE_NAME'; result = foreach result generate q.'PAGE_NAME' as 'name', count(q) as 'nbcalls', percentile_cont(0.95) within group (order by q.'RUN_TIME') as 'p95time', sum(q.'RUN_TIME') as 'totaltime', avg(q.'RUN_TIME') as 'avgtime', max(TIMESTAMP_DERIVED_sec_epoch) as 'lastused'; result = order result by ('name' desc); result = limit result 5000;`};
    await this.queryStats(conn,mametstats, vfQuery,"VFP");

    if(this.flags.prevfile) this.mergeStats(mametstats,this.flags.prevfile);

    fs.writeFileSync("./mametST.js", "let mameasures = " +  JSON.stringify(mametstats, null, '\t') , 'utf-8');

    // Return an object to be displayed with --json
    return { readmd: 'done' };
  }


  // get id of a dataset to use it in query afterward
private async getDatasetID(conn : Connection,dsname : string){
  let apiver = conn.getApiVersion();
	let dsQuery = `/services/data/v${apiver}/wave/datasets/${dsname}`;
	this.ux.log("Query to get dataset info: " + dsQuery);
	let dsinfo = await conn.request({url:dsQuery});
	//this.ux.log(JSON.stringify(dsinfo));
	let dsinf = dsinfo["id"] + '/' + dsinfo["currentVersionId"];
	this.ux.log("id for dataset " + dsname + " is: " + dsinf);
	return dsinf;
}

// Query analytics to list all entrypoints (called from ui or asynchronously)
private async queryStats(conn: Connection, mstats : {[key: string]: Entryp}, classQuery : {query: string}, shortname:string):Promise<void>{
    this.ux.log('query for ' + shortname +  ' stats: ' + JSON.stringify(classQuery));

    let apiver = conn.getApiVersion();
    let apcls = await conn.request({
      method: 'POST',
      url:`/services/data/v${apiver}/wave/query`,
      body: JSON.stringify(classQuery)});
    
    for(let anelt of apcls["results"]["records"]){
      let el = new Entryp(anelt["name"],shortname);
      el.avgtime = anelt["avgtime"];
      el.nbcalls = anelt["nbcalls"];
      el.p95time = anelt["p95time"];
      el.avgtime = anelt["avgtime"];
      el.lastused = anelt["lastused"];
      mstats[el.keyname] = el;
      }
  }


// Add stats from a previous stats file: only keep lastest use stats for each name
// By aggregating stats that way, keep last time a component was used
private mergeStats(mametstats: {[key: string]: Entryp},filename:string){
	// First load existing list of tags and tagged components  from previous datamamet2.js
	let prevST:any = {oldStats:{}};
	vm.createContext(prevST); 

	try{
		if(! fs.existsSync(filename)){
      this.ux.log("Not updating mametST, could not find previous stats file: " + filename);
      return;
    }
		var prevcontent = fs.readFileSync(filename,'utf8');
		this.ux.log("Read previous mametST.js file, size " + prevcontent.length);
		vm.runInContext(prevcontent + "; oldStats = mameasures ; ", prevST);

		if(Object.keys(prevST.oldStats).length>0){
			this.ux.log("Merging with stats of former file, with nb items: " + Object.keys(prevST.oldStats).length);
			for(let k of Object.keys(prevST.oldStats)){
        let prevElt: Entryp = <Entryp> prevST.oldStats[k];
        if(!mametstats.hasOwnProperty(k) || mametstats[k].lastused<prevElt.lastused){
          mametstats[k] = prevElt;
          this.ux.log("adding elt " + JSON.stringify(prevElt));
			  }
		  }
      this.ux.log("Tags are merged");
    }
	}catch(err){
		this.ux.log(err);
	}
}

}