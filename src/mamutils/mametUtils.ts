export class Cmpinfo {
	sfid: string;
	cmptype: string;
	ns: string;
	cmpname: string;
	table?: string;
	auraType?: string;
	bundleId?: string;
	description: string;
	createdDate: number;
	lastModifiedDate: number;
	subcmps: string[] = [];
	metrics: string[] = [];
	parents: string[] = [];
	children: string[] = [];
	tags: string[] = [];
	cluster: string;
	active:boolean = false;
	color:string = "grey";
	shape:string = "rect";
	hidden:boolean = false;
	constructor(cmpname : string, thetype :string, theid : string){
		this.cmpname = cmpname;
		this.cmptype = thetype;
		this.sfid = theid;
	}
}

export class Entryp {
	name: string;
	cmptype: string;
	child: string;
	nbcalls : number = 0;
	totaltime : number = 0;
	avgtime : number = 0;
	p95time : number = 0;
	lastused : number = 0;
	get keyname(){
		let cleanName = this.name.replace(/[ \-\(\)\/\.\<\>,]/g,"_");
		let kname = (this.cmptype + "_" + cleanName).toUpperCase();
		return kname
	}
	constructor(cmpname : string, thetype : string){
		this.name = cmpname;
		this.cmptype = thetype;
	}
}
