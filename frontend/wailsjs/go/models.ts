export namespace fonts {
	
	export class Entry {
	    family: string;
	    path: string;
	    source: string;
	    hasCJK: boolean;
	    verified: boolean;
	    bytes: number;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.family = source["family"];
	        this.path = source["path"];
	        this.source = source["source"];
	        this.hasCJK = source["hasCJK"];
	        this.verified = source["verified"];
	        this.bytes = source["bytes"];
	    }
	}

}

export namespace fsutil {
	
	export class ZipEntry {
	    name: string;
	    data: string;
	
	    static createFrom(source: any = {}) {
	        return new ZipEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.data = source["data"];
	    }
	}

}

export namespace imageinfo {
	
	export class Info {
	    path: string;
	    name: string;
	    width: number;
	    height: number;
	    aspect: string;
	    format: string;
	    bytes: number;
	    mime: string;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.aspect = source["aspect"];
	        this.format = source["format"];
	        this.bytes = source["bytes"];
	        this.mime = source["mime"];
	    }
	}

}

export namespace pyexec {
	
	export class Result {
	    ok: boolean;
	    data: number[];
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = source["data"];
	        this.error = source["error"];
	    }
	}
	export class Status {
	    available: boolean;
	    python: string;
	    version: string;
	    scriptDir: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.python = source["python"];
	        this.version = source["version"];
	        this.scriptDir = source["scriptDir"];
	        this.message = source["message"];
	    }
	}

}

