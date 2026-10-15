package android.util

import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.io.Reader

/** Minimal JVM-test implementation of the Android streaming JSON API. */
class JsonReader(reader: Reader) : Closeable {
    private sealed interface Value {
        data class ObjectValue(val entries: List<kotlin.Pair<String, Value>>) : Value
        data class ArrayValue(val values: List<Value>) : Value
        data class StringValue(val value: String) : Value
        data class NumberValue(val value: String) : Value
        data class BooleanValue(val value: Boolean) : Value
        data object NullValue : Value
    }

    private sealed interface Frame {
        class ObjectFrame(val entries: List<kotlin.Pair<String, Value>>, var index: Int = 0) : Frame
        class ArrayFrame(val values: List<Value>, var index: Int = 0) : Frame
    }

    private val root = toValue(JSONObject(reader.readText()))
    private val frames = ArrayDeque<Frame>()
    private var pending: Value? = null
    private var rootConsumed = false

    fun beginObject() {
        frames.addLast(asObject(takeValue()))
    }

    fun endObject() {
        check(frames.removeLast() is Frame.ObjectFrame)
    }

    fun beginArray() {
        frames.addLast(asArray(takeValue()))
    }

    fun endArray() {
        check(frames.removeLast() is Frame.ArrayFrame)
    }

    fun hasNext(): Boolean = when (val frame = frames.lastOrNull()) {
        is Frame.ObjectFrame -> frame.index < frame.entries.size
        is Frame.ArrayFrame -> frame.index < frame.values.size
        null -> !rootConsumed
    }

    fun nextName(): String {
        val frame = frames.lastOrNull() as? Frame.ObjectFrame ?: error("Not in an object")
        check(pending == null)
        val entry = frame.entries[frame.index++]
        pending = entry.second
        return entry.first
    }

    fun nextString(): String = when (val value = takeValue()) {
        is Value.StringValue -> value.value
        is Value.NumberValue -> value.value
        else -> error("Expected a string")
    }

    fun nextLong(): Long = nextString().toLong()

    fun nextInt(): Int = nextString().toInt()

    fun nextBoolean(): Boolean = when (val value = takeValue()) {
        is Value.BooleanValue -> value.value
        else -> error("Expected a boolean")
    }

    fun nextNull() {
        check(takeValue() == Value.NullValue)
    }

    fun skipValue() {
        takeValue()
    }

    fun peek(): JsonToken {
        val value = pending ?: when (val frame = frames.lastOrNull()) {
            is Frame.ObjectFrame -> return if (frame.index < frame.entries.size) JsonToken.NAME else JsonToken.END_OBJECT
            is Frame.ArrayFrame -> frame.values.getOrNull(frame.index)
            null -> if (rootConsumed) null else root
        }
        return value?.let(::tokenFor) ?: JsonToken.END_DOCUMENT
    }

    override fun close() = Unit

    private fun takeValue(): Value {
        pending?.let {
            pending = null
            return it
        }
        val frame = frames.lastOrNull()
        if (frame is Frame.ArrayFrame) return frame.values[frame.index++]
        if (!rootConsumed && frame == null) {
            rootConsumed = true
            return root
        }
        error("No value is available")
    }

    private fun asObject(value: Value): Frame.ObjectFrame {
        val objectValue = value as? Value.ObjectValue ?: error("Expected an object")
        return Frame.ObjectFrame(objectValue.entries)
    }

    private fun asArray(value: Value): Frame.ArrayFrame {
        val arrayValue = value as? Value.ArrayValue ?: error("Expected an array")
        return Frame.ArrayFrame(arrayValue.values)
    }

    private fun tokenFor(value: Value): JsonToken = when (value) {
        is Value.ObjectValue -> JsonToken.BEGIN_OBJECT
        is Value.ArrayValue -> JsonToken.BEGIN_ARRAY
        is Value.StringValue -> JsonToken.STRING
        is Value.NumberValue -> JsonToken.NUMBER
        is Value.BooleanValue -> JsonToken.BOOLEAN
        Value.NullValue -> JsonToken.NULL
    }

    private fun toValue(value: Any?): Value = when (value) {
        JSONObject.NULL, null -> Value.NullValue
        is JSONObject -> {
            val entries = mutableListOf<kotlin.Pair<String, Value>>()
            val keys = value.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                entries.add(key to toValue(value.opt(key)))
            }
            Value.ObjectValue(entries)
        }
        is JSONArray -> Value.ArrayValue(List(value.length()) { index -> toValue(value.opt(index)) })
        is String -> Value.StringValue(value)
        is Boolean -> Value.BooleanValue(value)
        is Number -> Value.NumberValue(value.toString())
        else -> Value.StringValue(value.toString())
    }
}
