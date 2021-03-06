/**
 * Created by silvia on 26/2/16.
 */

//Removed map.d import as no necessary
import {Injectable} from "@angular/core";
import {Http, RequestOptions, RequestMethod, Request} from '@angular/http';
import 'rxjs/add/operator/map';
import {Observable} from "rxjs/Observable";
import {Observer} from "rxjs/Rx";

/*
const ES_URL = 'http://jenkins:jenkins130@elasticsearch.kurento.org:9200/';
const INDEX = "<kurento-*>";
 */
 const MORE_DAYS = 200;     //Days to add when a loadMore request


@Injectable()
export class ElasticService {

    public elasticURL = 'http://127.0.0.1:9200/';
    public elasticINDEX = "<logstash-*>";


    scroll:string = "";         //Elasticsearch scroll indicator

    private sizeOfPage:number = 10;

    private nResults:number = 0;

    private maxResults:number = 50;

    private currentRequest:RequestOptions;

    private state: {filesFilter: any, dateFilter: any} = {filesFilter:"", dateFilter: ""};

    //attributes names. default is as following
    fields: Array<string> = ["@timestamp", "message", "logger_name", "thread_name", "level", "HOSTNAME", "path", "host", "type"];

    //Holds which field in a log stores its time
    public isTimestampField = "@timestamp";


    constructor(private _http: Http) {

    }

    public listIndices() {                     //Never used
        return this._http.get('http://localhost:9200/_stats/index,store')
            .map(res=>res.json())
            .map(res => {
                return Object.getOwnPropertyNames(res.indices);
            });
    }

    public requestWithState(requestOptions:any, emitter: Observer<any>) {
      //Check state
        let actualbody = JSON.parse(requestOptions.body);
        let dateFilterHappenedBefore = false;
        let fileFilterHappenedBefore = false;

        if (this.state.filesFilter || this.state.dateFilter) {
            let itHappenedBefore = false;
                if (actualbody.query.bool) {
                    let i = 0;
                    for (let musts of actualbody.query.bool.must) {

                        if (musts.range && this.state.dateFilter) {             // if loadByDate has already happened in current request
                          actualbody.query.bool.must[i].range = this.state.dateFilter.range;
                          dateFilterHappenedBefore = true;

                        } else if ((musts['query_string']||musts.bool) && this.state.filesFilter) {     //musts.bool indicates more than one file filter
                          actualbody.query.bool.must[i] = this.state.filesFilter;
                          fileFilterHappenedBefore = true;
                        }
                        i++;

                    }
                }

                if (this.state.dateFilter && !dateFilterHappenedBefore) {
                    let futuremust;
                    if(actualbody.query.bool && actualbody.query.bool.must) {
                        futuremust = actualbody.query.bool.must;
                        futuremust.push(this.state.dateFilter);
                    } else {
                        futuremust = [actualbody.query, this.state.dateFilter];
                    }
                    actualbody.query = {
                        bool: {
                          must:
                          futuremust
                        }
                    };
                }
                if (this.state.filesFilter && !fileFilterHappenedBefore) {
                    let futuremust;
                    if (actualbody.query.bool && actualbody.query.bool.must) {
                      futuremust = actualbody.query.bool.must;
                      futuremust.push(this.state.filesFilter);
                    } else {
                      futuremust = [actualbody.query, this.state.filesFilter];
                    }
                    actualbody.query = {
                      bool: {
                        must: futuremust
                      }
                    };
                }
            requestOptions.body = JSON.stringify(actualbody);
        }

        this.listAllLogs(requestOptions, emitter);
    }

    /*
     * Lists all logs matching the API options
     */
    public listAllLogs(requestOptions:any, emitter: Observer<any>, allfields: boolean = false): void {

        this._http.request(new Request(requestOptions))
            .map((responseData)=> { return responseData.json()})        //Important include 'return' keyword
            .map((answer)=> {
                let id = answer._scroll_id;
                this.scroll = id;                //id has to be assigned before mapLogs, which only returns the hits.

                answer = this.mapLogs(answer, allfields);

                return answer;
            })
            .subscribe(batch=> {
                this.nResults=this.nResults+this.sizeOfPage;
                emitter.next(batch);
                if(this.nResults<this.maxResults && batch.length==this.sizeOfPage){         //if length is less than size of page there is no need for a scroll
                    let body2 = {
                        "scroll" : "1m",
                        "scroll_id" : this.scroll
                    };
                    let url2 = this.elasticURL + '_search/scroll';
                    let requestOptions2 = this.wrapRequestOptions(url2, body2);
                    this.listAllLogs(requestOptions2, emitter);
                    return;
                }else {
                    this.nResults=0;
                    emitter.complete();
                }

            }, err => { if(err.status===200){
                    emitter.error(new Error("Cannot access ElasticSearch instance (ERR_CONNECTION_REFUSED)"))
                } else if(err.status===400) {
                    emitter.error(new Error("Cannot access ElasticSearch instance, please check the configuration tab"))
                } else {
                    emitter.error(new Error("Internal server error or not found"))
            }
            });

        return;
    }

    public getRowsDefault() {            //NOTE SCROLL ID! Elasticsearch scroll wouldn't work without it
        let url =this.elasticURL + this.elasticINDEX + '/_search?scroll=1m&filter_path=_scroll_id,hits.hits._source,hits.hits._type';

        let body= {
            sort: [
                    { [this.isTimestampField]: "asc" }
                ],
            query: {
               range: {
                            [this.isTimestampField]: {
                                gte: "now-200d",
                                lte: "now" }
               }
            },
            size: this.sizeOfPage
            //The following are the fields that are requested from each log. They should be consistent with the definition of logValue
            //_source: ["host", "thread_name", "logger_name", "message", "level", "@timestamp"] 
        };
        let requestOptions = this.wrapRequestOptions(url,body);
        this.currentRequest = requestOptions;

        //IMPORTANT RESTART STATE WHEN REFRESHING DATA
        this.state.dateFilter = "";
        this.state.filesFilter = "";

        let observable = Observable.create((observer) => this.listAllLogs(requestOptions, observer));

        return observable;
    }


    public search(value:string, orderByRelevance: boolean) {
        let sort;
        if(orderByRelevance) {
            let options1 = "_score";
            sort = [options1]
        }else{
             let options2 = { [this.isTimestampField]: 'asc'};
            sort = [options2];
        }
        let fields=[];
        for(let f of this.fields) {
            if(!(f.indexOf("@")>0||f.indexOf("time")>0)) {
                fields.push(f);
            }
        }
        let body = {
            "query":{
                "multi_match": {
                    "query":value,
                    "type":"best_fields",
                    "fields": fields,         //Not filter by time: parsing user input would be required
                    "tie_breaker":0.3,
                    "minimum_should_match":"30%"
                }
            },
            size:this.sizeOfPage,
            sort:
                sort

        };
        let url = this.elasticURL + this.elasticINDEX + '/_search?scroll=1m';

        let requestOptions2 = this.wrapRequestOptions(url,body);
        if (!orderByRelevance) {            //Fetching more as it is implemented now uses timestamp of the older log
            this.currentRequest = requestOptions2;
        } else {
            this.currentRequest = null;
        }
        let observable = Observable.create((observer) =>
            this.requestWithState(requestOptions2, observer));

        return observable;
    }


    loadMore(lastLog: any, loadLater: boolean){
        if(this.currentRequest) {
            let logTime = lastLog.time || lastLog[this.isTimestampField];
            let lessThan, greaterThan;
            let changeStateGreater;
            if(loadLater) {     //later in time: closer to today
                lessThan = logTime+"||+"+MORE_DAYS+"d";
                greaterThan = logTime;
                changeStateGreater = false;
            } else {
                lessThan = logTime;
                greaterThan = logTime+"||-"+MORE_DAYS+"d"; //"Date Math starts with an anchor date, which can either be now, or a date string ending with ||. (ElasticSearch)"
                changeStateGreater = true;
            }

            return this.loadByDate(lessThan, greaterThan, true, changeStateGreater);
        } else {
            return Observable.create((ob) => {ob.complete()});
        }
    }

    changeStateDateFilter(lessThan, greaterThan, isLoadMore, greaterOrLesser) {
        if(this.currentRequest) {
            let newBody = JSON.parse(this.currentRequest.body);

            let addition = {
                range: {
                    [this.isTimestampField]: {
                        "gte": greaterThan,
                        "lte": lessThan
                    }
                }
            };

            if (isLoadMore && this.state.dateFilter) {    //we will need to update state.dateFilter
                let filterTime = this.state.dateFilter.range[this.isTimestampField];
                if (greaterOrLesser) {
                    filterTime.gte = greaterThan;   //we do not touch less than: it's the original one before load more
                } else {
                    filterTime.lte = lessThan;         //same for the opposite
                }
                this.state.dateFilter.range[this.isTimestampField] = filterTime;
            } else {
                //console.log("he entrado por aqui"+addition.range[this.isTimestampField].gte)
                this.state.dateFilter = addition;   //We do not worry about the original state as we overwrite it
            }
        } else {
            let addition = {
                range: {
                    [this.isTimestampField]: {
                        "gte": greaterThan,
                        "lte": lessThan
                    }
                }
            };
            this.state.dateFilter = addition;
        }
    }

    loadByDate(lessThan, greaterThan, isLoadMore, greaterOrLesser) {
        let oldRequestGreaterThan;
        let notSupported = false;
        let newBody;
        if(this.currentRequest) {
            newBody = JSON.parse(this.currentRequest.body);

            let addition = {
                range: {
                    [this.isTimestampField]: {
                        "gte": greaterThan,
                        "lte": lessThan
                    }
                }
            };

            this.changeStateDateFilter(lessThan, greaterThan, isLoadMore, greaterOrLesser);  //we will need to update state.dateFilter

            let itHappenedBefore = false;
            if(newBody.query.bool) {
                let i = 0;
                for(let musts of newBody.query.bool.must) {
                    if(musts.range) {             //check if loadByDate has already happened in current request
                        newBody.query.bool.must[i].range = addition.range;
                        itHappenedBefore = true;
                        break;
                    }
                    i++;
                }
            }
            if(!itHappenedBefore) {
                let futuremust;
                if(newBody.query.bool && newBody.query.bool.must) {
                    futuremust = newBody.query.bool.must;
                    futuremust.push(addition);
                } else {
                    futuremust = [newBody.query, addition];
                }
                newBody.query = {
                    bool: {
                        must:
                            futuremust
                    }
                };
            }
        } else {    //It is ordered by relevance
            notSupported = true;
        }

        let loadMoreObservable = Observable.create((observer) => {
            if (/*!(oldRequestGreaterThan === greaterThan) && */!notSupported) {     //Last request and last log match. It means there has been a load more with the same result: no more results to be fetched
                this.currentRequest.body = JSON.stringify(newBody);
                let observableAux;
                if(!isLoadMore) {
                    observableAux = Observable.create((observeraux) => this.requestWithState(this.currentRequest, observeraux));
                } else {
                    //We have updated the state for later, but we want to fetch what is left in the grid, not everything again
                    observableAux = Observable.create((observeraux) => this.listAllLogs(this.currentRequest, observeraux));
                }

                observableAux.subscribe(logs => {
                    observer.next(logs);
                }, (err)=>console.log(err), ()=>{observer.complete()});
            } else {
                //If last log's time (greaterThan) is the same as the last request, it means there were no more results to fetch
                observer.error(new Error("Request not supported. Reason: request to be ordered by relevance"));
            }
        });
        return loadMoreObservable;
    }

    generalSearch(to, from, searchinput, byRelevance) {          //search with date and query
        this.changeStateDateFilter(to, from, false, false);
        return this.search(searchinput, byRelevance);

    }

    loadByFile(file:string) {
        let newBody = JSON.parse(this.currentRequest.body);
        let addition = {
            "query_string" : {
                "default_field": "path",
                "query": "*" + file + "*"
            }
        };

        let itHappenedBefore = false;
        if(newBody.query.bool) {
            let i = 0;

            for(let musts of newBody.query.bool.must) {
                if (musts.bool) {               //We are already filtering by 2 or more other files
                    newBody.query.bool.must[i].bool.should.push(addition);

                    itHappenedBefore = true;
                    this.state.filesFilter = newBody.query.bool.must[i];
                    break
                } else if(musts['query_string']) {      //we were filtering by another file

                    newBody.query.bool.must[i] = {
                        bool: {
                            should: [
                                musts,
                                addition
                            ]
                        }
                    };
                    itHappenedBefore = true;
                    this.state.filesFilter = newBody.query.bool.must[i];
                    break;
                }
                i++;
            }
            if(!itHappenedBefore) {
                this.state.filesFilter = addition;
            }
        } else {
            this.state.filesFilter = addition;
        }

        let observable = Observable.create((observer) =>
            this.requestWithState(this.currentRequest, observer));

        return observable;
    }

    /*
     * Gets more recent log of index, for config purposes
     */
    getFirstLog() {
        let body = {
            "query": {
                "match_all": {}
            },
            "size": 1
        };
        let url =this.elasticURL + this.elasticINDEX +'/_search';
        let requestOptions = this.wrapRequestOptions(url,body);
        let observable = Observable.create((observer: Observer<any>) =>
            this.listAllLogs(requestOptions, observer, true));

        return observable.map((elasticlist: Array<any>) => elasticlist[0]); //ElasticService returns an array of one element
    }

    removeFileState(file: string) {
        file = "*"+file+"*";
        if(this.state.filesFilter.bool) {
            let i = 0;
            for(let filter of this.state.filesFilter.bool.should) {
                if(filter.query_string.query === file){
                    break;
                }
                i++;
            }
            if(this.state.filesFilter.bool.should.length>2) {
                this.state.filesFilter.bool.should.splice(i, 1);
            } else {
                this.state.filesFilter = this.state.filesFilter.bool.should[Math.abs(i-1)]      //take the contrary of i (the not removed)
            }
        } else {
            this.state.filesFilter = "";
            //load grid without that filter
            //current request have that filter set, but requestWithState updates it
        }

        let observable = Observable.create((observer) => this.requestWithState(this.currentRequest, observer));
        return observable;
    }

    wrapRequestOptions(url:string, body:any) {
        return new RequestOptions({
            method: RequestMethod.Post,
            url,
            body: JSON.stringify(body)
        });
    }

    mapLogs(answer: any, allfields: boolean = false): any[] {
        let result: any[]=[];
        if(answer) {
            for(let a of answer.hits.hits) {
                let b:any;
                if (!allfields) {
                    b = this.elasticLogProcessing(a);
                } else {
                    b = this.selectingFieldsProcessing(a);
                }
                result.push(b);
            }
        }
        return result;
    }

    elasticLogProcessing(logEntry: any) {
        let logValue: any = {};
        for(let at of this.fields) {
            logValue[at] = logEntry._source[at];
        }

        return logValue;
    }

    /*
     * Needed for initial configuration in which there is need to select attribures of interest in an example log
     * We do not use this.fields as they are not selected yet
     */
    selectingFieldsProcessing(logEntry) {
        let logValue = {};
        for(let k of Object.keys(logEntry._source)) {
            logValue[k] = logEntry._source[k];
        }
        return logValue;
    }
}
