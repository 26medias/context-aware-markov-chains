/**
* js-weighted-list.js
*
* version 0.3
*
* This file is licensed under the MIT License, please see MIT-LICENSE.txt for details.
*
* https://github.com/timgilbert/js-weighted-list is its home.
*/

class WeightedList {
    constructor(initial) {
        this.weights = {};
        this.data = {};
        this.length = 0;
        this.hasData = false;

        initial = initial != undefined ? initial : [];

        if (Array.isArray(initial)) {
            for (let i in initial) {
                this.push(initial[i]);
            }
        } else {
            throw new Error(`Invalid type of initial passed to WeightedList constructor. Type: ${initial.constructor.name}' (expected array or nothing)`);
        }
    }

    /**
     * Add a single item to the list. The parameter passed in represents a single
     * key, with a weight and optionally some data attached.
     * 
     * @param {Array|Object} element Either a 2/3 element array of [key, weight, data] (data i optional), or an object with {key: k, weight: w, data: d} where data is optional.
     */
    push(element) {
        // Catch undefineds or empty arrays.
        if (!element) throw new Error('element is not an array or object or is empty.');
        let key, weight, data;

        if (Array.isArray(element)) {
            key = element[0];
            weight = element[1];
            data = element[2];

            // e.g. wl.push([])
            if (!key || typeof key !== 'string') throw new Error('element needs at least two elements. First element is undefined or not a string.');
            // I suppose we could default to 1 here, but the API is already too forgiving.
            if (!weight || typeof weight !== 'number') throw new Error('element needs at least two elements. Second element is undefined or not a number.');
        } else if (typeof element === 'object') {
            // We expect {key: 'zombies', weight: 10, data: {fast: true}}
            key = element.key;
            weight = element.weight;
            data = element.data;

            if (!key || typeof key !== 'string') throw new Error('element.key is not defined or is not a string.');
            if (!weight || typeof weight !== 'number') throw new Error('element.weight is not defined or is not a number.');
        } else {
            // If it somehow got through the first catcher
            throw new Error('element is not a supported type. Expected [key, weight] or {key: k, weight: w}')
        }

        return this._pushValues(key, weight, data);
    }

    /**
     * Add an item to the WeightedList
     * 
     * @access private
     * @param {String} key The key under which the item is stored.
     * @param {Number} weight The weight to assign to the item.
     * @param {?Object} data Any optional data for the item.
     */
    _pushValues(key, weight, data) {
        if (!key || typeof key !== 'string') throw new Error('key is undefined or not a string.');
        if (!weight || typeof weight !== 'number') throw new Error('weight is undefined or not a number.');
        if (this.weights[key]) throw new Error(`An item with the key '${key}' already exists.`);
        if (weight <= 0) throw new Error(`weight must be higher than 0, got ${weight}`);

        this.weights[key] = weight;
        if (data) {
            this.hasData = true;
            this.data[key] = data;
        }
        
        this.length++;
    }

    /**
     * Add the given weight to the list item with the give key. This operation
     * will silently create the key if it does not already exist
     * 
     * @todo Might be nice to have a version of this that would throw an error on an unknown key.
     * 
     * @param {String} key Key to add weight onto.
     * @param {Number} weight Weight to add.
     */
    addWeight(key, weight) {
        if (!key || typeof key !== 'string') throw new Error('key is undefined or not a string.');
        if (!weight || typeof weight !== 'number') throw new Error('weight is undefined or not a number.');

        this.weights[key] += weight;
    }

    /**
     * Select `n` elements (without replacement).
     * If `remove` is true, removes the elements from the list.
     * 
     * @param {Number} [n=1] Amount of elements to get
     * @param {Boolean} [remove=false] Remove the elements from the list or not.
     * @returns {Array}
     */
    peek(n=1, remove=false) {
        if (!n || typeof n !== 'number') throw new Error('n is undefined or not a number.');
        if (typeof remove !== 'boolean') throw new Error('remove is undefined or not a boolean.');
        if (this.length - n < 0) throw new Error(`Stack underflow! Tried to retrieve ${n} element(s) from a list of ${this.length}`);

        let heap = this._buildWeightedHeap();
        let result = [];

        for (let i = 0; i < n; i++) {
            let key = heap.pop();

            result.push(this.hasData ? {key, data: this.data[key]} : key);
            
            if (remove) {
                delete this.weights[key];
                delete this.data[key];
                this.length--;
            }
        }

        return result;
    }

    /**
     * Return the entire list in a random order. Does not edit the list.
     * 
     * @returns {Array}
     */
    suffle() {
        return this.peek(this.length);
    }

    /**
     * Removes an item/number of items from the start of the list.
     * 
     * @param {Number} [n=1] Amount of items to pop
     */
    pop(n=1) {
        return this.peek(n, true);
    }

    /**
     * Builds a WeightedHeap out of the data in the list.
     */
    _buildWeightedHeap() {
        let items = [];

        for (let key in this.weights) {
            if (this.weights.hasOwnProperty(key)) items.push([key, this.weights[key]]);
        }

        return new WeightedHeap(items);
    }
}

/**
 * A JavaScript implementation of the algorithm described by Jasen Orendorff here: http://stackoverflow.com/a/2149533/87990
 * 
 * @prop {Number} weight
 * @prop {Number} value
 * @prop {Number} total
 */
class HeapNode {
    constructor(weight, value, total) {
        this.weight = weight;
        this.value = value;
        this.total = total; // Total weight of this node and its children.
    }
}

class WeightedHeap {
    /**
     * Construct a WeightedHeap
     * 
     * Note, we're using a heap structure here for its tree properties, not as a
     * classic binary heap. A node heap[i] has children at heap[i<<1] and at
     * heap[(i<<1)+1]. Its parent is at h[i>>1]. Heap[0] is vacant.
     */
    constructor(items) {
        this.heap = [null]; // Math is easier to read if we index array from 1

        // First put everything on the heap
        for (let i in items) {
            let weight = items[i][1];
            let value = items[i][0];
            this.heap.push(new HeadNode(weight, value, weight));
        }

        // Now go through the heap and add each node's weight to its parent
        for (let i = this.heap.length - 1; i > 1; i--) this.heap[i >> 1].total += this.heap[i].total;
    }

    pop() {
        // Start with a random amount of gas
        let gas = this.heap[i].total * Math.random();

        // Start driving at the root node;
        let i = 1;

        // While we have enough gas to keep going past i
        while (gas > this.heap[i].weight) {
            gas -= this.heap[i].weight; // Drive past i
            i <<= 1; // Move to first Child

            if (gas > this.heap[i].total) {
                gas -= this.heap[i].total; // Drive past firstchild and its descendants
                i++; // Move on to second child
            }
        }

        // Out of gas - i is our selected node
        let value = this.heap[i].value;
        let selectedWeight = this.heap[i].weight;

        this.heap[i].weight = 0; // Make sure i isn't chosen again

        while (i > 0) {
            this.heap[i].total -= selectedWeight // Remove the weight from its parent's total
            i >>= 1; // Move to the next parent
        }

        return value;
    }
}

// NB: another binary heap implementation is at http://eloquentjavascript.net/appendix2.html

module.exports = WeightedList;