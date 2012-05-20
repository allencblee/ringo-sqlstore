var runner = require("./runner");
var assert = require("assert");

var Store = require("../lib/sqlstore/store").Store;
var sqlUtils = require("../lib/sqlstore/util");
var store = null;
var Book = null;
var Author = null;

const MAPPING_BOOK = {
    "properties": {
        "title": {
            "type": "string",
            "column": "book_title",
            "length": 255,
            "nullable": false
        },
        "authorId": {
            "type": "integer",
            "column": "book_f_author",
            "nullable": false
        },
        "available": {
            "type": "boolean"
        }
    }
};

function populate(nrOfBooks) {
    store.beginTransaction();
    for (var i=0; i<nrOfBooks; i+=1) {
        var nr = i + 1;
        var authorId = (i % 2) + 1;
        var book = new Book({
            "title": "Book " + nr,
            "authorId": authorId,
            "available": (i % 2) === 0
        });
        book.save();
    }
    store.commitTransaction();
    return;
};

exports.setUp = function() {
    store = new Store(runner.getDbProps());
    Book = store.defineEntity("Book", MAPPING_BOOK);
    return;
};

exports.tearDown = function() {
    var conn = store.getConnection();
    [Book, Author].forEach(function(ctor) {
        var schemaName = ctor.mapping.schemaName || store.dialect.getDefaultSchema(conn);
        if (sqlUtils.tableExists(conn, ctor.mapping.tableName, schemaName)) {
            sqlUtils.dropTable(conn, store.dialect, ctor.mapping.tableName, schemaName);
            if (ctor.mapping.id.hasSequence() && store.dialect.hasSequenceSupport()) {
                sqlUtils.dropSequence(conn, store.dialect, ctor.mapping.id.sequence, schemaName);
            }
        }
    });
    store.connectionPool.stopScheduler();
    store.connectionPool.closeConnections();
    store = null;
    Book = null;
    Author = null;
    return;
};

/**
 * Basic collection test, including iteration
 */
exports.testBasics = function() {
    populate(11);
    Author = store.defineEntity("Author", {
        "properties": {
            "name": {
                "type": "string"
            },
            "books": {
                "type": "collection",
                "query": "from Book"
            }
        }
    });
    var author = new Author({
        "name": "Author of all books"
    });
    // "books" collection is undefined as long as author is transient
    assert.isUndefined(author.books);
    author.save();
    // after persisting "books" collection is existing and populated at first access
    assert.strictEqual(author.books.length, 11);
    // iteration tests
    for (var i=0; i<author.books.length; i+=1) {
        assert.strictEqual(author.books.get(i)._id, i + 1);
    }
    var cnt = 0;
    for each (var book in author.books) {
        assert.isTrue(book instanceof Book);
        assert.strictEqual(book._id, cnt + 1);
        cnt += 1;
    }
    assert.strictEqual(cnt, author.books.length);
    cnt = 0;
    author.books.forEach(function(book, idx) {
        assert.isTrue(book instanceof Book);
        assert.strictEqual(book._id, cnt + 1);
        cnt += 1;
    });
    assert.strictEqual(cnt, author.books.length);
    // array methods
    assert.strictEqual(author.books.indexOf(author.books.get(2)), 2);
    assert.strictEqual(author.books.filter(function(book, idx) {
        return book._id % 2 === 0;
    }).length, 5);
    assert.isTrue(author.books.some(function(book) {
        return book._id === 5;
    }));
    assert.isTrue(author.books.every(function(book) {
        return book instanceof Book;
    }));
    var ids = author.books.map(function(book) {
        return book._id;
    });
    ids.forEach(function(id, idx) {
        assert.strictEqual(id, idx + 1);
    });
    return;
};

exports.testWithQueryParameter = function() {
    populate(11);
    Author = store.defineEntity("Author", {
        "properties": {
            "name": {
                "type": "string"
            },
            "books": {
                "type": "collection",
                "query": "from Book where Book.id > :threshold",
                "params": {
                    "threshold": 6
                }
            }
        }
    });
    var author = new Author({
        "name": "Author of half of the books"
    });
    author.save();
    author = Author.get(1);
    assert.strictEqual(author.books.length, 5);
    author.books.forEach(function(book, idx) {
        assert.strictEqual(book._id, idx + 7);
    });
};

/**
 * Collection with filtering via foreignProperty and ordering
 */
exports.testWithForeignProperty = function() {
    populate(11);
    Author = store.defineEntity("Author", {
        "id": {
            "column": "AUTHOR_ID"
        },
        "properties": {
            "name": {
                "type": "string"
            },
            "books": {
                "type": "collection",
                "query": "from Book where Book.authorId = :id order by Book.id desc"
            }
        }
    });
    var author = new Author({
        "name": "Author of just a bunch of books"
    });
    assert.isUndefined(author.books);
    author.save();
    assert.isNotUndefined(author.books);
    assert.strictEqual(author.books.length, 6);
    // due to ordering first book is the last one
    assert.strictEqual(author.books.get(0)._id, 11);
    return;
};

/**
 * Collection with filtering via local- and foreignProperty and ordering
 */
exports.testWithLocalAndForeignProperty = function() {
    populate(11);
    Author = store.defineEntity("Author", {
        "properties": {
            "name": {
                "type": "string"
            },
            "realId": {
                "type": "integer"
            },
            "books": {
                "type": "collection",
                "query": "select Book from Book, Author where Book.authorId = :realId order by Book.id desc"
            }
        }
    });
    var author = new Author({
        "name": "Author of just a bunch of books",
        "realId": 2 // mimick other author
    });
    assert.isUndefined(author.books);
    author.save();
    assert.isNotUndefined(author.books);
    assert.strictEqual(author.books.length, 5);
    // due to ordering first book is the last one
    assert.strictEqual(author.books.get(0)._id, 10);
    return;
};

/**
 * Partitioned collection with custom partition size, ordering and filtering
 * with foreignProperty
 */
exports.testPartitionedCollection = function() {
    populate(101);
    Author = store.defineEntity("Author", {
        "properties": {
            "name": {
                "type": "string"
            },
            "books": {
                "type": "collection",
                "isPartitioned": true,
                "partitionSize": 10,
                "query": "select Book.id from Book where Book.authorId = :id order by Book.id desc"
            }
        }
    });
    var author = new Author({
        "name": "Author of just a bunch of books"
    });
    author.save();

    assert.strictEqual(author.books.length, 51);
    // due to ordering first book is the last one
    assert.strictEqual(author.books.get(0)._id, 101);
    assert.isNotUndefined(author.books.partitions[0]);
    var book = author.books.get(10);
    assert.isNotUndefined(author.books.partitions[1]);
    assert.strictEqual(book._id, 81);
    book = author.books.get(50);
    assert.isNotUndefined(author.books.partitions[5]);
    for (var i=2; i<5; i+=1) {
        assert.isUndefined(author.books.partitions[i], "Partition " + i +
                " should be undefined");
    }
    return;
};

//start the test runner if we're called directly from command line
if (require.main == module.id) {
    system.exit(runner.run(exports, arguments));
}
