/* tslint:disable:no-unused-variable */
/**
 * Created by Silvia on 01/05/2016.
 */
import {GridComponent} from './grid.component';

import {
    expect, it, iit, xit,
    describe, ddescribe, xdescribe,
    beforeEach, beforeEachProviders, withProviders,
    async, inject
} from '@angular/core/testing';
import { Component } from '@angular/core';

import {TestComponentBuilder} from '@angular/compiler/testing';

import {By}             from '@angular/platform-browser';
import {provide, Directive}        from '@angular/core';
import {ViewMetadata}   from '@angular/core';
import {PromiseWrapper} from '@angular/core/src/facade/promise';


import {ElasticService} from "../shared/services/elastic.service";
import 'rxjs/add/operator/map';
import {Observable} from "rxjs/Rx";
import {fakeRowsProcessed} from "../shared/utils/fakeData";
/*import {
 TEST_BROWSER_PLATFORM_PROVIDERS,
 TEST_BROWSER_APPLICATION_PROVIDERS
 } from '@angular/platform-browser/testing';*/
import {AgGridNg2} from "ag-grid-ng2/main";
import {GridOptions} from "ag-grid/main";

/*setBaseTestProviders(TEST_BROWSER_PLATFORM_PROVIDERS,
 TEST_BROWSER_APPLICATION_PROVIDERS);*/
export function main() {
    class MockElasticService {
        constructor() {
        }

        getRowsDefault() {
            console.log('sending fake answers!');
            return Observable.of(fakeRowsProcessed);
        }

        search(input:string, searchByRelevance:boolean) {
            let match:any[] = [];
            for (let log of fakeRowsProcessed) {
                for (let field in log) {
                    if (log[field].toLowerCase().indexOf(input.toLowerCase()) != -1) {
                        match.push(log);
                        break;
                    }
                }
            }
            return Observable.of(match);
        }

        loadByDate(lessThan, greaterThan) {
            //greater than 10-04-2016 less than 13-04-2016
            let rows = fakeRowsProcessed.slice(34, 39);
            return Observable.of(rows);
        }
    }

    @Directive({
     selector: "ag-grid-ng2"
     })
     class MockAgGrid {
     constructor() {}
     }

    class MockGridOptions {
        public api = {
            showLoadingOverlay: () => {
            },
            hideOverlay: () => {
            }
        };

        constructor() {
            this.api.showLoadingOverlay = () => {
                console.log("Loading")
            };
            this.api.hideOverlay = () => {
            }
        };

    }

    describe('-> AppComponent <-', () => {
        let elasticService;
        let myComponent, element, fixture2;

        beforeEachProviders(() => [
            provide(ElasticService, {useClass: MockElasticService}),
        ]);


        beforeEach(async(inject([TestComponentBuilder], (tcb) => {
            return tcb
                .overrideDirective(GridComponent, AgGridNg2, MockAgGrid)
                .createAsync(GridComponent)
                .then((fixture) => {
                    console.log("aqui estamos");
                    fixture2 = fixture;
                    myComponent = fixture.componentInstance;
                    myComponent.gridOptions = new MockGridOptions();
                    element = fixture.nativeElement;
                    fixture.detectChanges();          //It should be needed to interact with DOM, but it's not
                });
        })));

        it('shows list of log items when created', () => {
            //Check component proper build
            expect(myComponent.gridOptions).not.toBeUndefined();
            expect(myComponent.rowData.length).toBe(40);
            expect(myComponent.showLoadMore).toBe(false);        //Because is less than 50, no need for loading more
        });

        it('searches among logs', () => {
            element.querySelector('#searchInput').value = "published";
            //trigger the 'search' button
            element.querySelector('.searchButton').click();
            expect(myComponent.rowData.length).toBe(13);
        });

        describe('loads by date', () => {
            let searchByDateButton;
            beforeEach(() => {
                searchByDateButton = element.querySelector('.searchByDate');
            });

            it('date is fine', () => {
                searchByDateButton.click();
                expect(myComponent.rowData.length).toBe(5);
            });

            it('date is bad formed', () => {
                element.querySelector('#from').value = "2016-04-17T08:10:55";
                element.querySelector('#to').value = "2016-04-12T08:00:43";
                searchByDateButton.click();
                fixture2.detectChanges();           //Otherwise the variable won't be updated in the template
                let error = element.querySelector('#errorMessage').textContent;
                expect(error).toBe("Please be sure that the 'to' field is not earlier than 'from' field");
            });
        });

        it('should mark rows matching a string', () => {
            //Logs displayed are the initial ones
            myComponent.mark("PingWatchdogSession");
            expect(myComponent.rowData[1].marked).toBe(true);
            expect(myComponent.rowData[37].marked).toBe(true);
        });

        it('should organize directories', () => {
            let dir = ["/app/poni/test/magic.file", "/app/juju/pe.ju"];
            let dire = myComponent.getDirectories();
            console.log(dire);
            //expect(dire.length).toBe(1); //Same root
            expect(dire.directories).notTobeUndefined();
            expect(dire.directories[0].directories[0].files.length).toBe(1);
        });

    });
}
