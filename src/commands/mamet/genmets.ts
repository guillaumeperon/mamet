import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, Connection } from '@salesforce/core';
import { AnyJson  } from '@salesforce/ts-types';
import * as fs from 'fs';
import * as xml2js from 'xml2js';
import * as vm from 'vm';

import { DescribeSObjectResult, QueryResult } from 'jsforce';

import {Cmpinfo} from '../../mamutils/mametUtils';


let tagList: {[key : string]: String}={
	"commons": "🔧"  , // https://www.utf8icons.com/character/127856/shortcake
	"sales": "🛒",// unicode rcbt : https://www.utf8icons.com/character/128722/shopping-trolley
	"service":"🎧",// unicode b360 : https://www.utf8icons.com/character/127911/headphone
	"experience":"🌐",// unicode assistance : https://www.utf8icons.com/character/127760/globe-with-meridians
	"SFS": "🚙" //https://www.utf8icons.com/character/128665/recreational-vehicle
};

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('mamet', 'genmets');

export default class genmets extends SfdxCommand {

  public static description = messages.getMessage('commandDescription');

  public static examples = [
  `$ sfdx mamet:genmets --auradir pathToSourceDir --targetusername myOrg@example.com
  Write metadata and dependencies in the file mametMD.js
  `
  ];

  public static args = [{name: 'file'}];

  protected static flagsConfig = {
	auradir: flags.string({char: 'd', description: messages.getMessage('auradirFlagDescription')})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  public async run(): Promise<AnyJson> {
	const conn : Connection = this.org.getConnection();

	let mametcmps: {[key: string]: Cmpinfo} = {};

	for(let m of ["ArticleType","ApexClass","ApexComponent","ApexPage","ApexTrigger","AuraDefinition","AppMenu","Audience",
		"AuraDefinitionBundle", "CronTrigger", "CustomApplication", "CustomApplicationComponent","AuthProvider","ContentAsset",
		"CustomField","CustomLabel", "CustomObject", "CustomSite", "CustomTab","CustomNotificationType",
		"CustomPageWebLink","CustomPermission","Dashboard", "ConnectedApp","EscalationRules","ExperienceBundle",
		"EmailTemplate", "FlexiPage","Flow", "FlowDefinition","HomePageComponent","HomePageLayout", "Layout",
		"LightningComponentBundle", "LightningComponentResource","LightningMessageChannel", "ListView", "ManagedContentType",
		"NavigationMenu","NamedCredential", "Network","PermissionSet","PlatformCachePartition",
		"PresenceUserConfig","PlatformEventChannel", "Profile", "Queue", "QuickAction",
		"QuickActionDefinition","RecordType","RemoteSiteSetting", "Report", "ReportFolder",
		"ReportType", "Role", "ServiceChannel","SamlSsoConfig","ServiceChannel","SharingRules","SharingSet",
		"ServicePresenceStatus", "StandardEntity", "StaticResource","TransactionSecurityPolicy","WebLink","Workflow",
		"StandardAction"])
		try{
			await this.querySFcompsInfo(conn, mametcmps,m);
		}catch(error){
			this.ux.log(` ${m} -- fail to get metadata`);
		}

	this.ux.log("Getting metadata dependency information");

	for(let m of ["ArticleType","ApexTrigger","AuraDefinition","AppMenu","Audience",
	  "AuraDefinitionBundle", "CronTrigger", "CustomApplication", "CustomApplicationComponent","AuthProvider","ContentAsset",
	  "CustomField","CustomLabel", "CustomObject", "CustomSite", "CustomTab","CustomNotificationType",
	  "CustomPageWebLink","CustomPermission","Dashboard", "ConnectedApp","EscalationRules","ExperienceBundle",
	  "EmailTemplate", "FlexiPage","Flow", "FlowDefinition","HomePageComponent","HomePageLayout", "Layout",
	  "LightningComponentBundle", "LightningComponentResource","LightningMessageChannel", "ListView", "ManagedContentType",
	  "NavigationMenu","NamedCredential", "Network","PermissionSet","PlatformCachePartition",
	  "PresenceUserConfig","PlatformEventChannel", "Profile", "Queue", "QuickAction",
	  "QuickActionDefinition","RecordType","RemoteSiteSetting", "Report", "ReportFolder",
	  "ReportType", "Role", "ServiceChannel","SamlSsoConfig","ServiceChannel","SharingRules","SharingSet",
	  "ServicePresenceStatus", "StandardEntity", "StaticResource","TransactionSecurityPolicy","WebLink","Workflow",
	  "StandardAction"])
	  try{
		await this.querySFCompDep(conn,mametcmps,m,null);
		await this.querySFCompDep(conn,mametcmps,null,m);
	  }catch(error){
		this.ux.log(` ${m} -- fail to get metadata dependencies`);
	  }
  
	await this.querySFCompDep2(conn,mametcmps,"MetadataComponentType",["ApexPage","ApexComponent","ApexClass","ApexTrigger","AuraDefinition","Layout","CustomField","FlexiPage","Flow", "FlowDefinition","LightningComponentBundle", "LightningComponentResource","QuickActionDefinition"]);
	await this.querySFCompDep2(conn,mametcmps,"RefMetadataComponentType",["ApexPage","ApexComponent","ApexClass","AuraDefinitionBundle","CustomObject","CustomField","StaticResource"]);
  
	this.ux.log('Dedup of components parents and children lists');
	this.dedupParentChildren(mametcmps);
	this.ux.log('DONE - Dedup of components parents and children lists');

	if(this.flags.auradir){
		this.ux.log('Fixing Aura components with source code');
		this.reorgAuraDeps(mametcmps,this.flags.auradir);
		this.ux.log('Done with Aura components with source code');	
	}

	this.ux.log('merging aura component into their component bundle');
	this.mergeAuraCmpToBundle(mametcmps);
	this.ux.log("Merged Aura components/bundles, number of items: " + Object.keys(mametcmps).length);
	
	this.ux.log('merging custom fields into their object');
	this.mergeCustomFieldsToTable(mametcmps);
	this.ux.log("Merged custom fields with their objects, number of items: " + Object.keys(mametcmps).length);

	this.ux.log("Generating clusters - start");
	let allclusters = this.genClusters2(mametcmps, 50 ,75);
	this.ux.log("Generating clusters - done");

	// this is to read and merge previous tags
	// TODO: prev file name should be a parameter 
	this.mergeMDtags(mametcmps,tagList,"./mametMD.js");

	fs.writeFileSync("./mametMD.js", "let tagList = " +  JSON.stringify(tagList, null, '\t') + ";\nlet macomps = " +  JSON.stringify(mametcmps, null, '\t') + ";\nlet allClusters = " +  JSON.stringify(allclusters, null, '\t') +";", 'utf-8');

	// Return an object to be displayed with --json
	return { readmd: 'done' };
  }



  //read with metadata api the list of one type of component
  private async querySFcompsInfo(conn: Connection,collect : {[key: string]: Cmpinfo},objType : string):Promise<void>{
	let apiver = conn.getApiVersion();

	let objinfo : DescribeSObjectResult = await conn.tooling.sobject(objType).describe();

	let params: string[] = ['id','CreatedDate','LastModifiedDate'];
	let nameF = objinfo.fields.filter(m=>m.nameField===true);
	let typeNameField = 'Id';
	if(nameF.length>0){
	  params.push(nameF[0].name);
	  typeNameField = nameF[0].name;
	}
	if(objinfo.fields.filter(a=>a.name==='NamespacePrefix' ).length>0) params.push('NamespacePrefix');
	if(objinfo.fields.filter(m=>m.name==='Description').length>0) params.push('Description');
	if(objinfo.fields.filter(m=>m.name==='TableEnumOrId').length>0) params.push('TableEnumOrId');
	if(objType==='AuraDefinition'){
	  params.push('AuraDefinitionBundleId');
	  params.push('DefType');
	}
	let wherePrm = '';
	if(objType==='Flow') wherePrm="+where+status='Active'"

	let objQuery : string = `/services/data/v${apiver}/tooling/query/?q=select+${params.join('+,+')}+from+${objType}${wherePrm}`;
	do {
	  let apcls : QueryResult<object> = ((await conn.request({url:objQuery})) as unknown) as QueryResult<object>;
	  this.ux.log(`Read ${apcls.records.length} ${objType} - query ${objQuery}`);
	  objQuery = (apcls.hasOwnProperty('nextRecordsUrl')) ? apcls.nextRecordsUrl : null;

	  for(let aline of apcls.records){
		if(aline['Id'] in collect){
		  this.ux.log(`Error adding component,  duplicate name with: ${JSON.stringify(collect[aline['Id']])}`);
		  continue;
		}
		let acmp = new Cmpinfo(aline[typeNameField],objType,aline['Id']);
		acmp.createdDate=Date.parse(aline['CreatedDate']);
		acmp.lastModifiedDate=Date.parse(aline['LastModifiedDate']);
		if(params.includes('Description')) acmp.description=aline['Description'];
		if(params.includes('NamespacePrefix')) acmp.ns = aline['NamespaceField'];
		if(params.includes('TableEnumOrId')) acmp.table = aline['TableEnumOrId'];
		if(params.includes('DefType')) acmp.auraType = aline['DefType'];
		if(params.includes('AuraDefinitionBundleId')) acmp.bundleId = aline['AuraDefinitionBundleId'];
		collect[aline['Id']]=acmp;
		//this.ux.log(JSON.stringify(collect[aline['Id']]));
	  }
	}while(objQuery!==null)
  }


  // read list of apex dependent on  apex classes with metadata dependency api
  private async querySFCompDep(conn: Connection,collect : {[key: string]: Cmpinfo},cmptype: string,refcmptype: string):Promise<void>{
	let whereclause: string[] = [];
	if(cmptype!=null){
	  whereclause.push(`MetadataComponentType = '${cmptype}'`);
	}
	if(refcmptype!=null){
	whereclause.push(`RefMetadataComponentType = '${refcmptype}'`);
	}
	let thequery = "SELECT MetadataComponentName, MetadataComponentType, MetadataComponentId, RefMetadataComponentName,RefMetadataComponentType,RefMetadataComponentId FROM MetadataComponentDependency Where " +  whereclause.join(" and ");
	const apdeplist = await conn.tooling.query(thequery);
	this.ux.log(`Dependencies from ${cmptype} to ${refcmptype}: ${apdeplist.records.length}`);
	this.processDepRes(apdeplist.records,collect);
  }


  // read list of apex dependent on  apex classes with metadata dependency api
  private async querySFCompDep2(conn: Connection,collect : {[key: string]: Cmpinfo},cmptype: string, typenames : string[]):Promise<void>{
	let apiver = conn.getApiVersion();
	
	let whereclause = typenames.map(typeN=>cmptype + "='" + typeN+ "'").join(" or ");
	let thequeryDef = `{
	  "operation": "query",
	  "query": "select MetadataComponentName, MetadataComponentType, MetadataComponentId, RefMetadataComponentName,RefMetadataComponentType,RefMetadataComponentId FROM MetadataComponentDependency WHERE ${whereclause}"
	}`;
	this.ux.log("dep query " + thequeryDef);
	let theQuery = await conn.request({
	  method: 'POST',
	  url:`/services/data/v${apiver}/tooling/jobs/query`,
	  body: thequeryDef});
	  this.ux.startSpinner(`Waiting bulk query ${theQuery["id"]} to complete`);
	while(true){
	  let wait5s = new Promise((resolve, _reject) => { setTimeout(() => resolve("done"), 5000) });
	  await wait5s;
	  let queryState = await conn.request({url:`/services/data/v${apiver}/tooling/jobs/query/${theQuery["id"]}`});
	  if(queryState["state"]==='JobComplete') break;
	  this.ux.setSpinnerStatus('Waiting for job to complete');
	}
	this.ux.stopSpinner('done with bulk query');
	let queryRes = await conn.request({url:`/services/data/v${apiver}/tooling/jobs/query/${theQuery["id"]}/results`});
	process.stdout.write(`\nNumber of dependencies: ${queryRes.length}\n`);
	this.processDepRes(queryRes,collect);
	}

	// add a list of  dependency infos to the components relations
	private processDepRes(queryRes,collect: {[key: string]: Cmpinfo}){
	  let numproc = 0;
	for(let aline of queryRes){
	  let acmp = null;
	  // filter out old flow versions
	  if((aline.MetadataComponentType==='Flow' && !(aline.MetadataComponentId in collect)) ||
	  (aline.RefMetadataComponentType==='Flow' && !(aline.RefMetadataComponentId in collect))) continue;

	  if(aline.MetadataComponentId in collect){
		acmp = collect[aline.MetadataComponentId];
		if(!acmp.cmpname) acmp.cmpname = aline.MetadataComponentName; // sometimes not avail otherwise
	  }else{
		acmp = new Cmpinfo(aline.MetadataComponentName,aline.MetadataComponentType, aline.MetadataComponentId);
		collect[aline.MetadataComponentId]= acmp;
	  }
	  let arefcmp = null;
	  if(aline.RefMetadataComponentId in collect){
		arefcmp = collect[aline.RefMetadataComponentId];
		if(!arefcmp.cmpname) arefcmp.cmpname = aline.RefMetadataComponentName; // sometimes not avail otherwise
	  }else{
		arefcmp = new Cmpinfo(aline.RefMetadataComponentName,aline.RefMetadataComponentType,aline.RefMetadataComponentId);
		collect[aline.RefMetadataComponentId]=arefcmp;
	  }
	  acmp.children.push(aline.RefMetadataComponentId);
	  arefcmp.parents.push(aline.MetadataComponentId);
	  numproc++;
	}
	if(numproc<queryRes.length) this.ux.log('Only active processes are analyzed, dependencies found: ' + numproc);
	return collect;
	}

	// remove dups in the list of parents and children
	private dedupParentChildren(cmps: {[key: string]: Cmpinfo}){
	  Object.values(cmps).forEach(a=>{
		a.parents=[...new Set(a.parents)];
		a.children=[...new Set(a.children)];
		  });
	  }
	

  // Better organize Cmpinfo components
  private mergeAuraCmpToBundle(collect : {[key: string]: Cmpinfo}){
	let defTypeToKind = {
	  APPLICATION : 'application',
	  COMPONENT : 'component',
	  EVENT : 'event',
	  INTERFACE : 'interface',
	  TOKENS : 'tokens collection',
	}
	let auraCmpKs = Object.keys(collect).filter(k=>collect[k].cmptype==="AuraDefinition");
	this.ux.log('Merging aura component parts into bundles ' +  Object.keys(auraCmpKs).length);
	for(let k of auraCmpKs){
	  let auCmp = collect[k];
	  if(auCmp.parents.length>0) this.ux.log("ERROR : aura component with a parent ? " + k );
	  if(!collect.hasOwnProperty(auCmp.bundleId)){
		  this.ux.log("ERROR : aura component without a bundle ? " + k);
		  continue;
	  }
	  let auBundle = collect[auCmp.bundleId];
	  if(auBundle===null){
		  this.ux.log('ERROR - aura component without a bundle???? ' + auCmp.cmpname);
		  continue;
	  }
	  // change links between that component and its children 
	  auBundle.subcmps.push(auCmp.cmpname);
	  if(defTypeToKind.hasOwnProperty(auCmp.auraType)) auBundle.auraType = defTypeToKind[auCmp.auraType];

	  for(let chid of auCmp.children){
		let target = collect[chid];
		// link to another aura component
		if(target.cmptype==="AuraDefinition"){
		  // same bundle: both will be deleted, do nothing
		  if(target.bundleId===auCmp.bundleId) continue;
		  // another bundle: link between the bundles
		  target = collect[target.bundleId];
		}else{ // target will not be deleted, remove ref to component
		  target.parents.splice(target.parents.indexOf(auCmp.sfid),1);
		}
		// links to its bundle: its merged so delete the link
		if(chid===auBundle.sfid) continue;
		// create the replacement link
		auBundle.children.push(target.sfid);
		target.parents.push(auBundle.sfid);
	  }
	}
	// delete the aura components
	for(let k of auraCmpKs){
	  delete collect[k];
	}
	// dedupParentChildren
	this.dedupParentChildren(collect);
  }


  // merge custom fields with tables 
  private mergeCustomFieldsToTable(collect : {[key: string]: Cmpinfo}){
	let cfKs = Object.keys(collect).filter(k=>collect[k].cmptype==="CustomField");
	// custom field "table" can be a standard table, but not in metadata: create them first
	for(let k of cfKs){
		let cfTbl = collect[k].table;
		if(!collect.hasOwnProperty(cfTbl)){
		  let newc = new Cmpinfo(cfTbl,"StandardEntity",cfTbl);
		  collect[cfTbl] =  newc;
		}
	}
	// now change the links  
	for(let k of cfKs){
	  let cfCmp = collect[k];
	  let tableCmp = collect[cfCmp.table];
	  tableCmp.subcmps.push(cfCmp.cmpname);
	  // step 1: links from customfield to children -> from table to children
	  for(let chid of cfCmp.children){
		let target = collect[chid];
		// links between customfields are managed in step 2 for the target
		if(target.cmptype==="CustomField") continue;
		// remove ref to component
		target.parents.splice(target.parents.indexOf(cfCmp.sfid),1);
		// if child is the field own table: its merged so no new link
		if(chid===tableCmp.sfid) continue;
		// create the replacement link
		tableCmp.children.push(target.sfid);
		target.parents.push(tableCmp.sfid);
	  }
	  // step 2: links from parents to customfield -> from table to customfield 
	  for(let paid of cfCmp.parents){
		let target = collect[paid];
		if(target.cmptype==="CustomField"){
		  // 2 fields of the same table will be deleted, do nothing
		  if(target.table===cfCmp.table) continue ;
		  // another field of another table: link the tables
		  target = collect[target.table];
		}else{ 
		  // target will not be deleted, remove ref to component
		  target.children.splice(target.children.indexOf(cfCmp.sfid),1);
		}
		// links to its own table: its merged so no new link
		if(paid===tableCmp.sfid) continue;
		// now create the replacement link
		tableCmp.parents.push(target.sfid);
		target.children.push(tableCmp.sfid);
	  }
	}
	//now delete the component from the list
	for(let k of cfKs){
	  delete collect[k];
	}
	// dedupParentChildren
	Object.values(collect).forEach(a=>{
	  a.parents=[...new Set(a.parents)];
	  a.children=[...new Set(a.children)];
	  });
  }


  // calculate clusters -- new algorithm
	private genClusters2(collect: {[key: string]: Cmpinfo},parMax : number ,nodMax : number):{[key : string]: string[]}{
	// clusters, key: name, value: array of elts parts of the cluster
	let allClusters:{[key : string]: string[]} = {
		'tests' : [],   // test classes
		'commons' : []  // commons components
	}; 
	// reset config
	Object.values(collect).forEach(item => delete item.cluster);
	// pool of objects not yet in cluster
	let objpool = new Set(Object.keys(collect)); 
	this.ux.log("clustering, total nber of elts: " + objpool.size);

	// tests classes are in a separate cluster
	let testsCl = allClusters['tests'];
	for(let a of objpool){
		let aElt = collect[a];
		if(aElt.cmptype!=='ApexClass') continue;
		let ename = aElt.cmpname
		if(ename.toUpperCase().includes("TEST")||ename.toUpperCase().includes("MOCK")){
			aElt.cluster="tests";
			testsCl.push(a);
			objpool.delete(a);
		};
	};
	this.ux.log("Nodes in test cluster: " + testsCl.length);

	// "commons" is the cluster of node with nb parents > parMax 
	// Iterate:  decrease the size of parMax 
	//  - add in commons elements with nb parents > parMax
	//  - create clusters of nodes without tests, commons, and existing clusters
	//  - clusters with size < nodMax are added to cluster list
	// 
	let commonsCl = allClusters['commons'];

	while(objpool.size>0){
		this.ux.log("Clustering, with common limit: " + parMax + " nb elts left: " + objpool.size );

		// add components to common
		for(let a of objpool){
			let aElt=collect[a];
			if(aElt.parents.length>=parMax){
				aElt.cluster="commons";
				commonsCl.push(a);
				objpool.delete(a);
			};
		};
		this.ux.log("--> Elements now in commons: " + commonsCl.length);

		// now try to build the other clusters
		let objP1 = new Set(objpool);
		let newClusters:{[key : string]: string[]} = {}; 
		for(let h of objP1){
			if(!objP1.has(h)) continue;//already in a cluster
			let hEl=collect[h];
			hEl.cluster= h;
			let headCluster =[h]; // create a new cluster
			newClusters[h] = headCluster;
			objP1.delete(h); // remove from the pool
			this.addToCluster(collect,hEl.parents,h,headCluster,objP1);
			this.addToCluster(collect,hEl.children,h,headCluster,objP1);
		};

		// Now keep only clusters with < nodMax nodes
		for(let k of Object.keys(newClusters)){
			let nds = newClusters[k];
			if(nds.length>nodMax){
				nds.forEach(n=>delete collect[n].cluster);
			}else{
				allClusters[k]=nds;
				nds.forEach(n=>objpool.delete(n));
			}
		};
		parMax = parMax - 1;
	}

	// a node in commons cluster but with all parents in the same cluster A is part of A, not commons
	let notInCommons=0;
	do{
		notInCommons=0;
		for(let elCm of commonsCl){
			let parentClusts = new Set(collect[elCm].parents.map(a=>collect[a].cluster));
			if(parentClusts.size!=1 || parentClusts.has("commons")) continue;
			let newCl = parentClusts.values().next().value;
			this.ux.log("Push elt " + elCm + " from cluster commons to cluster with all its parents: " + newCl);
			collect[elCm].cluster = newCl;
			allClusters[newCl].push(elCm);
			commonsCl = commonsCl.filter(a=>a!=elCm);
			notInCommons+=1;
		}
	}while(notInCommons>0);

	// Not done anymore: cluster is calculated by code. Tags are chosen by admins. DO NOT MIX
	// set attribute "tags"  to commons for nodes from commonsCl
	//for(let elCm of commonsCl) collect[elCm].tags = ["commons"];

	return allClusters;
}

	// recursively find cluster nodes
private addToCluster(collect: {[key: string]: Cmpinfo},newElts:string[],clusterName: string,theCluster:string[],objpool:Set<String>){
	for(let eltname of newElts){
		if(!objpool.has(eltname)) continue; // no loop
		theCluster.push(eltname);
		objpool.delete(eltname);
		let acmp = collect[eltname];
		acmp.cluster=clusterName;
		this.addToCluster(collect,acmp.parents,clusterName,theCluster,objpool);
		this.addToCluster(collect,acmp.children,clusterName,theCluster,objpool);
	}
}


// Get tags found in an existing tag file and put those tags on new tag file
// TODO: manage the vm.script in typescript... 
private mergeMDtags(collect: {[key: string]: Cmpinfo}, allTags:{[key : string]: String},filename:string){
	// First load existing list of tags and tagged components  from previous datamamet2.js
	let prevMDs:any = {oldTags:{},oldComps:{}};
	vm.createContext(prevMDs); 

	try{
		if(! fs.existsSync(filename)){
			this.ux.log("Not updating mametMD, could not find previous metadata file: " + filename);
			return;
		}
		var prevconf = fs.readFileSync(filename,'utf8');
		this.ux.log("Read previous mametMD.js file, size " + prevconf.length);
		vm.runInContext(prevconf + ";oldTags=tagList ;oldComps =macomps;", prevMDs);

		if(Object.keys(prevMDs.oldTags).length>0){
			this.ux.log("Merging with tags of former file, with nb items: " + Object.keys(prevMDs.oldTags).length);
			for(let k of Object.keys(prevMDs.oldTags)){
				let shortname: string = <string> prevMDs.oldTags[k];
				allTags[k] = shortname;
			}
		}
		this.ux.log("Taglist is merged");

		if(Object.keys(prevMDs.oldComps).length>0){
			this.ux.log("Merging with components tags of former file, with nb items: " + Object.keys(prevMDs.oldComps).length);
			for(let k of Object.keys(prevMDs.oldComps)){
		        let prevCmp: Cmpinfo = <Cmpinfo> prevMDs.oldComps[k];
        		if(prevCmp.tags.length>0 && collect.hasOwnProperty(k)) collect[k].tags = prevCmp.tags;
			  }
		  }
	      this.ux.log("Components tags are merged");
	}catch(err){
		this.ux.log(err);
	}

}

/*
Code to manage reading and writing files
*/

// read all file names under a directory
private recursFiles(dirname:string):string[] {
    var results:string[] = [];
    fs.readdirSync(dirname).forEach(afile => {
        let thefile = dirname + '/' + afile;
        var stat = fs.statSync(thefile);
        if (stat && stat.isDirectory()) { 
            results = results.concat(this.recursFiles(thefile));
        } else { 
            results.push(thefile);
        }
    });
    return results;
}


private reorgAuraDeps(collect: {[key: string]: Cmpinfo},dirname:string){

	this.ux.log("searching aura components in dir " + dirname);
	let allFiles = this.recursFiles(dirname);
	
	let eventsByName = {}; // eventname to event object
	
	this.ux.log("Adding type application/component and proper name to events");
	
	// find and enrich event definition
	for(let fname of allFiles.filter(f=>f.endsWith('evt'))){
		let cmpname = fname.split('/').slice(-2, -1)[0];
		let xmldat = fs.readFileSync(fname);
	
		let jsondat = null;    
		xml2js.parseString(xmldat,{ mergeAttrs: true }, (err, result) => {
			jsondat = result;
		});
	
		if(!jsondat.hasOwnProperty('aura:event')){
			this.ux.log('Error with evt file: ' + fname);
			continue;
		}
	
		let currEventList = Object.values(collect).filter(a=>a.cmptype==="AuraDefinitionBundle" && a.cmpname.toUpperCase()===cmpname.toUpperCase());
		if(currEventList.length===0){
			this.ux.log("could not find event from mamet file with name: " + cmpname);
			continue;
		}
		let currEvent = currEventList[0];
	
		let ename = 'c:' + cmpname;
		eventsByName[ename] = currEvent;
		currEvent.cmpname = ename;
		let el = jsondat['aura:event'];
		currEvent.auraType = "event_" + el.type[0];
	}
	
	
	// $A.get("e.c:ZZZ_ApplictionEventToActivateBTMobile");
	
	this.ux.log("Fixing component - events relations");
	// manage component definition
	
	for(let fname of allFiles.filter(f=>f.endsWith('cmp'))){
	
		// Read one aura component xml file
		let cmpname = fname.split('/').slice(-2, -1)[0];
		let xmldat = fs.readFileSync(fname);
		let jsondat = null;    
		xml2js.parseString(xmldat,{ mergeAttrs: true }, (err, result) => {
		jsondat = result;
		});
	
		if(!jsondat.hasOwnProperty('aura:component')){
			this.ux.log('Error with cmp file: ' + fname);
			continue;
		}
	
		// find component definition from datamamet.js
		let currCmpList = Object.values(collect).filter(a=>a.cmptype==="AuraDefinitionBundle" && a.cmpname.toUpperCase()===cmpname.toUpperCase())
		if(currCmpList.length===0){
			this.ux.log("could not find component from mamet file with name: " + cmpname);
			continue;
		}
		let currCmp = currCmpList[0];
	
		// find list of events sent and received in xml descriptor
		let el = jsondat['aura:component'];
		//let evsent = el['aura:registerEvent'];
		let evrecv = el['aura:handler'];
	
		// remove component lifecycle events, they dont have an "event" attribute
		evrecv = evrecv ? evrecv.filter(e=>e.hasOwnProperty('event')) : [] ;
	
	
		// add or inverse links from events to a component that receive it
		evrecv.forEach(e=> {
			// find existing event or create a new one
			let evname = e.event[0];
			//evname = (e.event)?e.event[0]:e.name[0] + '_'+ cmpname;
			let ee = eventsByName[evname];
			if(ee){
				// remove link from component to event
				currCmp.children.splice(currCmp.children.indexOf(ee.sfid),1);
				ee.parents.splice(ee.parents.indexOf(currCmp.sfid),1);
				// create link from event to component
				currCmp.parents.push(ee.sfid);
				ee.children.push(currCmp.sfid);
				this.ux.log("reversed link from " + currCmp.cmpname + " to " + ee.cmpname);
			}else{
				let evkey = cmpname + '_' + evname.replace(':','_');
				ee = {
					sfid : evkey,
					cmpname : evname,
					cmptype : "AuraDefinitionBundle",
					parents: [],
					children : [currCmp.sfid],
					metrics: []
				}
				currCmp.parents.push(evkey);
				eventsByName[evkey] = ee;
				collect[evkey] = ee;
				this.ux.log("Added event with no .evt file: " + JSON.stringify(ee));
			}
		});
		
	
	/*
	
	TODO: not sure it is useful. In case mergeAuraCmpToBundle must be executed first
	
	// search events sent in controller and helper without being declare in cmp
		for(fjs of[fname.slice(0,-4)+"Controller.js",fname.slice(0,-4)+"Helper.js"]){
			if(!allFiles.includes(fjs)) continue;
			let datjs = fs.readFileSync(fjs).toString();
			// search substring whose start could be event names
			let strsjs = datjs.split('$A.get(');
			strsjs.shift(); // remove before first $A.get( 
			for(evstr of strsjs){
				sep=evstr[0]; // can be " or '
				let oneev = evstr.slice(1,evstr.indexOf(sep,1));
				if(oneev.startsWith("e.c:")){
					anevt = eventsByName[oneev.slice(2)];
					if(anevt===null){
						this.ux.log("Problem in file " + fjs+ ' with event ' + oneev);
						continue;
					} 
					if(! anevt.parents.includes(currCmp.sfid))
						this.ux.log("missing parent for event " + JSON.stringify(anevt) + " on cmp  " + JSON.stringify(currCmp));
					if(! currCmp.children.includes(anevt.sfid))
						this.ux.log("missing child for event " + JSON.stringify(anevt)+ " on cmp  " + JSON.stringify(currCmp));
				}
			}
		}
	
	
		/*
	 
		
		// display links from component to the events it sends
		if(evsent){
			// events are added to the jsevts list
			evsent.forEach(e=> {
				let ee = evts[e.type[0]];
				if(!ee){
					this.ux.log("// Event with no .evt file: " + JSON.stringify(e));
					ee = 'EV' + e0++;
					evts[e.type[0]]=ee;
					this.ux.log(ee + ' [label="'+e.type[0]+'",fillcolor=yellow];');
				}
				if(!jsevts.includes(ee)) jsevts.push(ee);
			});
			this.ux.log(cn + ' -> {' + jsevts.join(',') + '};');
		}
	*/
	
	}
	


}


}
